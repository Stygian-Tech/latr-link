package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/auth"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/developer"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
)

type testAuth struct {
	context       auth.Context
	err           error
	calls         int
	requireClient bool
	upstream      string
}

func (a *testAuth) Authenticate(_ *http.Request, require bool, upstream string) (auth.Context, error) {
	a.calls++
	a.requireClient = require
	a.upstream = upstream
	return a.context, a.err
}

type testRepository struct {
	records        map[string]latr.Record
	attested       int
	attestError    error
	writes         [][]latr.Write
	bookmarkLimit  int
	bookmarkCursor string
}

func (r *testRepository) DID() string { return "did:plc:owner" }
func (r *testRepository) AttestOAuthSession(context.Context) error {
	r.attested++
	return r.attestError
}
func (r *testRepository) List(_ context.Context, col string, limit int, cursor string) (latr.Page, error) {
	if col == latr.Bookmark {
		r.bookmarkLimit = limit
		r.bookmarkCursor = cursor
	}
	p := latr.Page{Records: []latr.Record{}}
	for id, record := range r.records {
		if strings.HasPrefix(id, col+"/") {
			p.Records = append(p.Records, record)
		}
	}
	return p, nil
}
func (r *testRepository) Get(_ context.Context, col, key string, _ bool) (*latr.Record, error) {
	record, ok := r.records[col+"/"+key]
	if !ok {
		return nil, nil
	}
	return &record, nil
}
func (r *testRepository) Apply(_ context.Context, writes []latr.Write) error {
	r.writes = append(r.writes, writes)
	for _, w := range writes {
		id := w.Collection + "/" + w.Key
		if strings.HasSuffix(w.Type, "#delete") {
			delete(r.records, id)
		} else {
			r.records[id] = latr.Record{URI: "at://" + r.DID() + "/" + id, CID: "new-cid", Value: w.Value}
		}
	}
	return nil
}
func fixture(t *testing.T) (*Server, *testAuth, *testRepository) {
	t.Helper()
	cfg := config.Config{AppEnv: "test"}
	store, e := developer.New(context.Background(), cfg, nil)
	if e != nil {
		t.Fatal(e)
	}
	s := New(cfg, store, nil, nil)
	t.Cleanup(s.Close)
	a := &testAuth{context: auth.Context{DID: "did:plc:owner", AccessTokenSignatureVerified: true}}
	r := &testRepository{records: map[string]latr.Record{}}
	s.Auth = a
	s.Repository = func(auth.Context) Repository { return r }
	return s, a, r
}
func request(s *Server, verb, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(verb, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func decoded(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &v); e != nil {
		t.Fatal(e, w.Body.String())
	}
	return v
}
func expect(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d != %d: %s", w.Code, status, w.Body.String())
	}
	if code != "" && decoded(t, w)["error"] != code {
		t.Fatalf("code != %s: %s", code, w.Body.String())
	}
}

type routeCase struct {
	nsid, verb, body, query string
	developer               bool
}

// Explicit names and verbs come from the published Swift route registry. Do not
// derive this matrix from the implementation: it must catch omissions and drift.
var routeMatrix = []routeCase{
	{"link.latr.bookmarks.listBookmarks", "GET", "", "", false},
	{"link.latr.bookmarks.listTags", "GET", "", "", false},
	{"link.latr.bookmarks.getBookmark", "GET", "", "?subject=https://example.com", false},
	{"link.latr.bookmarks.saveBookmark", "POST", `{"subject":"at://did:plc:author/app.bsky.feed.post/1"}`, "", false},
	{"link.latr.bookmarks.syncMetadata", "POST", `{}`, "", false},
	{"link.latr.bookmarks.setState", "PATCH", `{"bookmarkUri":"at://did:plc:owner/community.lexicon.bookmarks.bookmark/1","state":"unread"}`, "", false},
	{"link.latr.bookmarks.setTags", "POST", `{"bookmarkUri":"at://did:plc:owner/community.lexicon.bookmarks.bookmark/1","tags":[]}`, "", false},
	{"link.latr.bookmarks.renameTag", "POST", `{"tag":"one","replacement":"two"}`, "", false},
	{"link.latr.bookmarks.deleteTag", "POST", `{"tag":"one"}`, "", false},
	{"link.latr.bookmarks.deleteBookmark", "POST", `{"bookmarkUri":"at://did:plc:owner/community.lexicon.bookmarks.bookmark/1"}`, "", false},
	{"link.latr.bookmarks.migrateLegacy", "POST", `{"upstreamDpopProof":"pool"}`, "", false},
	{"link.latr.saved.listItems", "GET", "", "", false},
	{"link.latr.saved.getItem", "GET", "", "?subjectUri=at://did:plc:author/app.bsky.feed.post/1", false},
	{"link.latr.saved.saveUrl", "POST", `{"url":"https://example.com"}`, "", false},
	{"link.latr.saved.saveSubject", "POST", `{"subjectUri":"at://did:plc:author/app.bsky.feed.post/1"}`, "", false},
	{"link.latr.saved.setState", "POST", `{"itemRkey":"one","state":"unread"}`, "", false},
	{"link.latr.saved.deleteItem", "POST", `{"itemRkey":"one"}`, "", false},
	{"link.latr.saved.migrateLegacy", "POST", `{}`, "", false},
	{"link.latr.preview.getOpenGraph", "GET", "", "?url=https://example.com", false},
	{"link.latr.discovery.resolveUrl", "GET", "", "?url=https://example.com", false},
	{"link.latr.auth.probe", "GET", "", "", false},
	{"link.latr.developer.listClients", "GET", "", "", true},
	{"link.latr.developer.createClient", "POST", `{"clientId":"test-client"}`, "", true},
	{"link.latr.developer.deleteClient", "POST", `{"clientId":"test-client"}`, "", true},
	{"link.latr.developer.listKeys", "GET", "", "?clientId=test-client", true},
	{"link.latr.developer.createKey", "POST", `{"clientId":"test-client"}`, "", true},
	{"link.latr.developer.revokeKey", "POST", `{"clientId":"test-client","keyId":"key"}`, "", true},
	{"link.latr.developer.getUsage", "GET", "", "", true},
}

func TestPublishedRouteMatrixAuthAndVerbs(t *testing.T) {
	if len(routeMatrix) != 28 || len(methods) != 28 {
		t.Fatal("published surface must contain all 28 methods")
	}
	for _, tc := range routeMatrix {
		t.Run(tc.nsid, func(t *testing.T) {
			s, a, _ := fixture(t)
			a.err = problem(401, "missing_auth", "missing auth")
			w := request(s, tc.verb, "/xrpc/"+tc.nsid+tc.query, tc.body)
			expect(t, w, 401, "AuthRequired")
			if a.calls != 1 || a.requireClient == tc.developer {
				t.Fatal("wrong auth policy")
			}
			if w.Header().Get("WWW-Authenticate") != "DPoP" || w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("missing auth/cache headers")
			}
			for _, verb := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
				if verb == tc.verb {
					continue
				}
				before := a.calls
				w = request(s, verb, "/xrpc/"+tc.nsid, `{}`)
				expect(t, w, 405, "InvalidRequest")
				if a.calls != before {
					t.Fatal("wrong verb authenticated")
				}
			}
		})
	}
	s, _, _ := fixture(t)
	for _, verb := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		expect(t, request(s, verb, "/xrpc/link.latr.unknown", `{}`), 404, "XrpcNotSupported")
	}
}
func TestAuthPrecedesValidationExceptMigration(t *testing.T) {
	s, a, _ := fixture(t)
	a.err = problem(401, "missing_auth", "missing")
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.saveBookmark", `not-json`), 401, "AuthRequired")
	expect(t, request(s, "GET", "/xrpc/link.latr.auth.probe?unknown=x", ``), 401, "AuthRequired")
	before := a.calls
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.migrateLegacy", `not-json`), 400, "InvalidRequest")
	if a.calls != before {
		t.Fatal("migration must decode proof pool first")
	}
}
func TestStrictInputsAndQueries(t *testing.T) {
	for _, tc := range []struct{ method, path, body string }{
		{"POST", "bookmarks.saveBookmark", `{}`}, {"POST", "bookmarks.saveBookmark", `{"subject":null}`}, {"POST", "bookmarks.saveBookmark", `{"subject":1}`}, {"POST", "bookmarks.saveBookmark", `{"subject":""}`}, {"POST", "bookmarks.saveBookmark", `{"subject":"https://a.com","unknown":1}`}, {"POST", "bookmarks.saveBookmark", `null`}, {"POST", "bookmarks.saveBookmark", `[]`}, {"POST", "bookmarks.saveBookmark", `{} {}`},
		{"POST", "bookmarks.setTags", `{"bookmarkUri":"uri"}`}, {"POST", "bookmarks.setTags", `{"bookmarkUri":"uri","tags":null}`}, {"POST", "bookmarks.setTags", `{"bookmarkUri":"uri","tags":[null]}`}, {"POST", "bookmarks.setTags", `{"bookmarkUri":"uri","tags":"tag"}`},
		{"PATCH", "bookmarks.setState", `{"bookmarkUri":"uri","state":null}`}, {"PATCH", "bookmarks.setState", `{"bookmarkUri":"uri","state":"other"}`}, {"POST", "bookmarks.syncMetadata", `{"limit":0}`}, {"POST", "bookmarks.syncMetadata", `{"limit":101}`}, {"POST", "bookmarks.syncMetadata", `{"limit":1.1}`}, {"POST", "bookmarks.syncMetadata", `{"cursor":[]}`},
		{"POST", "bookmarks.renameTag", `{"tag":"a","replacement":"a"}`}, {"POST", "bookmarks.renameTag", `{"tag":"a","replacement":"b","limit":26}`}, {"POST", "saved.migrateLegacy", `{"upstreamDpopProof":"pool"}`},
	} {
		t.Run(tc.path+tc.body, func(t *testing.T) {
			s, _, _ := fixture(t)
			w := request(s, tc.method, "/xrpc/link.latr."+tc.path, tc.body)
			if w.Code != 400 {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
	for _, q := range []string{"?unknown=1", "?limit=1&limit=2", "?limit=0", "?limit=101", "?limit=wat", "?limit=%zz", "?tag=", "?tag=%20"} {
		s, _, _ := fixture(t)
		expect(t, request(s, "GET", "/xrpc/link.latr.bookmarks.listBookmarks"+q, ""), 400, "InvalidRequest")
	}
	s, _, _ := fixture(t)
	r := httptest.NewRequest("POST", "/xrpc/link.latr.bookmarks.syncMetadata", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "text/plain")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	expect(t, w, 400, "InvalidRequest")
}
func TestRESTSaveBodyDiscriminator(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `{"url":"https://a.com"}`, `{"kind":null,"url":"https://a.com"}`, `{"kind":"url","subjectUri":"at://did:plc:a/collection/1"}`, `{"kind":"subject","url":"https://a.com"}`, `{"kind":"url","url":null}`, `{"kind":"other","url":"https://a.com"}`} {
		s, _, repo := fixture(t)
		w := request(s, "POST", "/v1/latr/saves", body)
		if w.Code != 400 || len(repo.writes) > 0 {
			t.Fatalf("%s: %d %s", body, w.Code, w.Body.String())
		}
	}
	for _, kind := range []string{"url", "subject"} {
		s, _, _ := fixture(t)
		_ = s.cache(context.Background(), "https://example.com", preview.Fields{Title: "Cached"})
		w := request(s, "POST", "/v1/latr/saves", `{"kind":"`+kind+`","url":"https://example.com","subjectUri":"at://did:plc:author/app.bsky.feed.post/1"}`)
		expect(t, w, 201, "")
		out := decoded(t, w)
		want := "https://example.com"
		if kind == "subject" {
			want = "at://did:plc:author/app.bsky.feed.post/1"
		}
		if out["subjectUri"] != want || out["kind"] != kind {
			t.Fatal(out)
		}
		if w.Header().Get("Deprecation") != "true" {
			t.Fatal("missing compatibility notice")
		}
	}
}
func TestMigrationProofBodyForwardingAndAttestation(t *testing.T) {
	s, a, repo := fixture(t)
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.migrateLegacy", `{"upstreamDpopProof":"pool","limit":100}`), 200, "")
	if a.upstream != "pool" {
		t.Fatal("migration proof body lost")
	}
	expect(t, request(s, "POST", "/v1/latr/migrate-lexicons", `{"upstreamDpopProof":"rest-pool"}`), 200, "")
	if a.upstream != "rest-pool" {
		t.Fatal("REST migration proof body lost")
	}
	expect(t, request(s, "POST", "/v1/latr/migrate-lexicons", `{"upstreamDpopProof":" "}`), 400, "missing_upstream_dpop")
	a.context.AccessTokenSignatureVerified = false
	repo.attestError = problem(401, "invalid_upstream_dpop", "rejected")
	for _, path := range []string{"/xrpc/link.latr.preview.getOpenGraph?url=https://example.com", "/xrpc/link.latr.discovery.resolveUrl?url=https://example.com", "/xrpc/link.latr.developer.listClients"} {
		expect(t, request(s, "GET", path, ""), 401, "InvalidDpop")
	}
	if repo.attested != 3 {
		t.Fatal(repo.attested)
	}
}
func TestDeveloperOwnershipAndSecretResponses(t *testing.T) {
	s, a, _ := fixture(t)
	expect(t, request(s, "POST", "/xrpc/link.latr.developer.createClient", `{"clientId":"my-client"}`), 200, "")
	w := request(s, "POST", "/xrpc/link.latr.developer.createKey", `{"clientId":"my-client","label":"Local"}`)
	expect(t, w, 200, "")
	secret, _ := decoded(t, w)["apiKey"].(string)
	if secret == "" {
		t.Fatal("one-time key missing")
	}
	for _, path := range []string{"/xrpc/link.latr.developer.listClients", "/xrpc/link.latr.developer.listKeys?clientId=my-client", "/xrpc/link.latr.developer.getUsage"} {
		w = request(s, "GET", path, "")
		expect(t, w, 200, "")
		if strings.Contains(w.Body.String(), secret) || strings.Contains(w.Body.String(), "keyHash") {
			t.Fatal("secret leaked", w.Body.String())
		}
	}
	a.context.DID = "did:plc:attacker"
	for _, tc := range []struct{ verb, path, body string }{{"GET", "listKeys?clientId=my-client", ""}, {"POST", "createKey", `{"clientId":"my-client"}`}, {"POST", "deleteClient", `{"clientId":"my-client"}`}, {"POST", "revokeKey", `{"clientId":"my-client","keyId":"unknown"}`}} {
		expect(t, request(s, tc.verb, "/xrpc/link.latr.developer."+tc.path, tc.body), 403, "Forbidden")
	}
	a.context.DID = "did:plc:owner"
	w = request(s, "GET", "/xrpc/link.latr.developer.listClients", "")
	expect(t, w, 200, "")
	if !strings.Contains(w.Body.String(), "my-client") {
		t.Fatal("attacker removed owner client")
	}
}
func TestErrorsDoNotExposeInternalDetails(t *testing.T) {
	w := httptest.NewRecorder()
	respondError(w, errors.New("database password=secret"), true)
	expect(t, w, 500, "InvalidRequest")
	if strings.Contains(w.Body.String(), "secret") {
		t.Fatal("internal detail leaked")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestPublishedRoutesSuccessfulDispatch(t *testing.T) {
	for _, tc := range routeMatrix {
		t.Run(tc.nsid, func(t *testing.T) {
			s, _, repo := fixture(t)
			client := &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(strings.NewReader(`<html><head><meta property="og:title" content="Article"><meta property="og:description" content="Description"></head></html>`)), Request: r}, nil
			})}
			s.Preview = preview.New(client, "https://identity.example", nil, "")
			bookmarkURI := "at://" + repo.DID() + "/" + latr.Bookmark + "/1"
			repo.records[latr.Bookmark+"/1"] = latr.Record{URI: bookmarkURI, CID: "bookmark-cid", Value: map[string]any{"$type": latr.Bookmark, "subject": "https://example.com", "createdAt": "2020"}}
			repo.records[latr.Metadata+"/1"] = latr.Record{URI: "at://" + repo.DID() + "/" + latr.Metadata + "/1", CID: "metadata-cid", Value: map[string]any{"$type": latr.Metadata, "bookmarkUri": bookmarkURI, "subject": "https://example.com", "state": "unread"}}
			repo.records[latr.SavedItem+"/one"] = latr.Record{URI: "at://" + repo.DID() + "/" + latr.SavedItem + "/one", CID: "saved-cid", Value: map[string]any{"$type": latr.SavedItem, "subjectUri": "at://did:plc:author/app.bsky.feed.post/1", "savedAt": "2020"}}
			_, e := s.Store.CreateClient(context.Background(), repo.DID(), "test-client", nil, false)
			if e != nil {
				t.Fatal(e)
			}
			key, _, e := s.Store.CreateAPIKey(context.Background(), repo.DID(), "test-client", nil)
			if e != nil {
				t.Fatal(e)
			}
			body := tc.body
			if strings.HasSuffix(tc.nsid, "createClient") {
				body = `{"clientId":"new-client"}`
			}
			if strings.HasSuffix(tc.nsid, "revokeKey") {
				body = `{"clientId":"test-client","keyId":"` + key.KeyID + `"}`
			}
			w := request(s, tc.verb, "/xrpc/"+tc.nsid+tc.query, body)
			expect(t, w, 200, "")
			if w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("missing private cache policy")
			}
			if strings.Contains(w.Body.String(), `"error"`) {
				t.Fatal(w.Body.String())
			}
		})
	}
}
func TestOptionalFieldsAndEmptyTags(t *testing.T) {
	s, _, repo := fixture(t)
	uri := "at://" + repo.DID() + "/" + latr.Bookmark + "/1"
	repo.records[latr.Bookmark+"/1"] = latr.Record{URI: uri, CID: "cid", Value: map[string]any{"subject": "at://did:plc:author/post/1", "createdAt": "2020", "tags": []string{"existing"}}}
	for _, body := range []string{`{"limit":null,"cursor":null}`, `{"limit":1,"cursor":""}`} {
		expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.syncMetadata", body), 200, "")
	}
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.setTags", `{"bookmarkUri":"`+uri+`","tags":[]}`), 200, "")
	if _, ok := repo.records[latr.Bookmark+"/1"].Value["tags"]; ok {
		t.Fatal("empty tags did not clear tags")
	}
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.saveBookmark", `{"subject":"at://did:plc:author/post/1","tags":null}`), 200, "")
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.deleteTag", `{"tag":"any","cursor":"bad"}`), 400, "InvalidRequest")
}
func TestRESTMigrationHeaderBypassesBody(t *testing.T) {
	s, a, _ := fixture(t)
	r := httptest.NewRequest("POST", "/v1/latr/migrate-lexicons", strings.NewReader(`malformed`))
	r.Header.Set("X-ATProto-Upstream-DPoP", "header-pool")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	expect(t, w, 200, "")
	if a.upstream != "" {
		t.Fatal("body override supplied despite header")
	}
}
func TestOAuthMetadataContracts(t *testing.T) {
	s, a, _ := fixture(t)
	s.Config.OAuthPublicOrigin = "https://latr.link/"
	s.Config.OAuthLatrkitPublicOrigin = "https://latrkit.dev/"
	for _, tc := range []struct{ name, client, redirect, scope string }{{"client-metadata.json", "L@tr.link", "https://latr.link/callback", baseScope + " include:app.userinput.authFull blob:*/*"}, {"extension-client-metadata.json", "L@tr.link Extension", "https://latr.link/extension/callback", baseScope}, {"latrkit-client-metadata.json", "LatrKit Developer Console", "https://latrkit.dev/callback", "atproto"}} {
		r := httptest.NewRequest("GET", "https://api.latr.link/oauth/"+tc.name, nil)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		expect(t, w, 200, "")
		out := decoded(t, w)
		if out["client_id"] != "https://api.latr.link/oauth/"+tc.name || out["scope"] != tc.scope || out["client_name"] != tc.client || out["dpop_bound_access_tokens"] != true {
			t.Fatal(out)
		}
		redirects, _ := out["redirect_uris"].([]any)
		if len(redirects) != 1 || redirects[0] != tc.redirect {
			t.Fatal(out)
		}
		if out["token_endpoint_auth_method"] != "none" || w.Header().Get("Access-Control-Allow-Origin") != "*" {
			t.Fatal(out)
		}
	}
	if a.calls != 0 {
		t.Fatal("public metadata required auth")
	}
}
func TestMissingRecordErrorNames(t *testing.T) {
	s, _, _ := fixture(t)
	for _, tc := range []struct{ verb, path, body, code string }{{"POST", "/xrpc/link.latr.saved.setState", `{"itemRkey":"missing","state":"unread"}`, "SavedItemNotFound"}, {"POST", "/xrpc/link.latr.saved.deleteItem", `{"itemRkey":"missing"}`, "SavedItemNotFound"}, {"PATCH", "/v1/latr/saves/missing/state", `{"state":"unread"}`, "bookmark_not_found"}, {"DELETE", "/v1/latr/saves/missing", "", "bookmark_not_found"}} {
		expect(t, request(s, tc.verb, tc.path, tc.body), 404, tc.code)
	}
}
func TestRESTSaveBodyErrorNames(t *testing.T) {
	for _, tc := range []struct{ body, code string }{{`{}`, "invalid_json"}, {`{"kind":null}`, "invalid_json"}, {`{"kind":"url"}`, "missing_url"}, {`{"kind":"url","url":null}`, "invalid_json"}, {`{"kind":"subject"}`, "missing_subject"}, {`{"kind":"subject","subjectUri":null}`, "invalid_json"}, {`{"kind":"invalid"}`, "invalid_body"}, {`{"kind":"url","url":""}`, "InvalidUrl"}} {
		s, _, _ := fixture(t)
		expect(t, request(s, "POST", "/v1/latr/saves", tc.body), 400, tc.code)
	}
}
func TestRESTPaginationCompatibility(t *testing.T) {
	for _, tc := range []struct {
		query  string
		limit  int
		cursor string
	}{{"", 100, ""}, {"?cursor=ignored", 100, ""}, {"?limit=1000&cursor=%20next%20", 100, "next"}, {"?limit=%2010%20&cursor=", 10, ""}} {
		s, _, repo := fixture(t)
		expect(t, request(s, "GET", "/v1/latr/saves"+tc.query, ""), 200, "")
		if repo.bookmarkLimit != tc.limit || repo.bookmarkCursor != tc.cursor {
			t.Fatalf("%s: got %d %s", tc.query, repo.bookmarkLimit, repo.bookmarkCursor)
		}
	}
	for _, query := range []string{"?limit=", "?limit=0", "?limit=invalid", "?limit=-1"} {
		s, _, _ := fixture(t)
		expect(t, request(s, "GET", "/v1/latr/saves"+query, ""), 400, "invalid_limit")
	}
}
