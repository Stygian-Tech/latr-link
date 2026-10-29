package pds

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func proof(method, htu string) string {
	b, _ := json.Marshal(map[string]string{"htm": method, "htu": htu})
	return "e30." + base64.RawURLEncoding.EncodeToString(b) + ".signature"
}
func TestProofPoolTargetAndSingleConsumption(t *testing.T) {
	p := NewProofPool(proof("GET", "https://other/xrpc/read") + "," + proof("GET", "https://pds/xrpc/read?x=1"))
	if s, _ := p.Consume("read", "POST", "https://pds"); s != "" {
		t.Fatal("wrong verb consumed")
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	count := 0
	for range 10 {
		wg.Go(func() {
			s, u := p.Consume("read", "get", "https://pds/")
			if s != "" {
				mu.Lock()
				count++
				mu.Unlock()
				if u != "https://pds/xrpc/read" {
					t.Error(u)
				}
			}
		})
	}
	wg.Wait()
	if count != 1 {
		t.Fatal(count)
	}
}
func TestOpaqueRequiresProofAndSessionDID(t *testing.T) {
	ctx := context.Background()
	calls := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/did:plc:alice":
			fmt.Fprintf(w, `{"service":[{"id":"#atproto_pds","serviceEndpoint":%q}]}`, server.URL)
		case "/xrpc/com.atproto.server.getSession":
			calls++
			if r.Header.Get("Authorization") != "DPoP opaque" || r.Header.Get("DPoP") == "" {
				t.Error("missing auth")
			}
			fmt.Fprint(w, `{"did":"did:plc:wrong"}`)
		default:
			calls++
			fmt.Fprint(w, `{"records":[]}`)
		}
	}))
	defer server.Close()
	c := NewClient(Auth{DID: "did:plc:alice", Authorization: "DPoP opaque"}, server.URL, server.Client())
	if _, e := c.List(ctx, latr.Bookmark, 10, ""); e == nil {
		t.Fatal("opaque token authenticated read without proof")
	}
	if calls != 0 {
		t.Fatal("unauthorized request reached PDS")
	}
	c.Pool = NewProofPool(proof("GET", server.URL+"/xrpc/com.atproto.server.getSession"))
	e := c.AttestOAuthSession(ctx)
	var gateway *Error
	if !errors.As(e, &gateway) || gateway.Code != "pds_session_did_mismatch" {
		t.Fatal(e)
	}
}
func TestTransportCASAndNoCredentialRedirect(t *testing.T) {
	ctx := context.Background()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/did:plc:alice":
			fmt.Fprintf(w, `{"service":[{"type":"AtprotoPersonalDataServer","serviceEndpoint":%q}]}`, server.URL)
		case "/xrpc/com.atproto.repo.applyWrites":
			var body struct {
				Writes []latr.Write `json:"writes"`
			}
			if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
				t.Error(e)
			}
			if len(body.Writes) != 1 || body.Writes[0].SwapRecord != "cid" {
				t.Error("CAS lost")
			}
			w.WriteHeader(409)
			fmt.Fprint(w, `{"error":"InvalidSwap"}`)
		case "/xrpc/com.atproto.repo.getRecord":
			http.Redirect(w, r, "https://example.com/leak", 302)
		}
	}))
	defer server.Close()
	c := NewClient(Auth{DID: "did:plc:alice", Authorization: "DPoP token", SignatureVerified: true, DPoPProof: "proof"}, server.URL, server.Client())
	if e := c.Apply(ctx, []latr.Write{latr.Update(latr.Bookmark, "key", map[string]any{"future": true}, "cid")}); !errors.Is(e, latr.ErrConflict) {
		t.Fatal(e)
	}
	if _, e := c.Get(ctx, latr.Bookmark, "key", true); e == nil {
		t.Fatal("followed credential redirect")
	}
}
func TestDIDWebURL(t *testing.T) {
	for did, want := range map[string]string{"did:web:example.com": "https://example.com/.well-known/did.json", "did:web:example.com:user:alice": "https://example.com/user/alice/did.json", "did:web:localhost%3A8443": "https://localhost:8443/.well-known/did.json"} {
		got, e := DIDDocumentURL(did, "")
		if e != nil || got != want {
			t.Fatalf("%s %v", got, e)
		}
	}
	if _, e := DIDDocumentURL("did:web:evil.com%2Fpath", ""); e == nil {
		t.Fatal("URL injection allowed")
	}
	if _, e := DIDDocumentURL("did:web:example.com:..", ""); e == nil {
		t.Fatal("traversal allowed")
	}
}

func TestRecordDecodingPreservesLargeUnknownNumbersAndRejectsMalformedKnownFields(t *testing.T) {
	ctx := context.Background()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/did:plc:alice":
			fmt.Fprintf(w, `{"service":[{"id":"#atproto_pds","serviceEndpoint":%q}]}`, server.URL)
		case "/xrpc/com.atproto.repo.listRecords":
			fmt.Fprint(w, `{"records":[{"uri":"at://did:plc:alice/community.lexicon.bookmarks.bookmark/one","cid":"cid","value":{"$type":"community.lexicon.bookmarks.bookmark","subject":"https://example.com","createdAt":"2026","futureInteger":9007199254740993}},{"uri":"at://did:plc:alice/community.lexicon.bookmarks.bookmark/bad","cid":"cid","value":{"$type":"community.lexicon.bookmarks.bookmark","subject":"https://example.com","createdAt":"2026","tags":["okay",42]}}]}`)
		case "/xrpc/com.atproto.repo.getRecord":
			fmt.Fprint(w, `{"uri":"at://did:plc:alice/link.latr.saved.item/bad","cid":"cid","value":{"$type":"link.latr.saved.item","subjectUri":"https://example.com","savedAt":"2026","note":42}}`)
		}
	}))
	defer server.Close()
	c := NewClient(Auth{DID: "did:plc:alice", SignatureVerified: true, Authorization: "DPoP token", DPoPProof: "gateway"}, server.URL, server.Client())
	page, err := c.List(ctx, latr.Bookmark, 100, "")
	if err != nil || len(page.Records) != 1 {
		t.Fatalf("malformed typed record was exposed: %+v %v", page, err)
	}
	data, err := json.Marshal(page.Records[0].Value)
	if err != nil || !strings.Contains(string(data), `"futureInteger":9007199254740993`) {
		t.Fatalf("large integer rounded: %s %v", data, err)
	}
	if _, err = c.Get(ctx, latr.SavedItem, "bad", false); err == nil {
		t.Fatal("malformed known field accepted")
	}
}

func TestTypedRecordValidationMatchesPinnedCodable(t *testing.T) {
	for _, test := range []struct {
		collection string
		value      map[string]any
	}{
		{latr.SavedItem, map[string]any{"$type": latr.SavedItem, "subjectUri": "https://example.com", "savedAt": "2026", "state": "unknown"}},
		{latr.External, map[string]any{"$type": latr.External, "url": "https://example.com", "normalizedUrl": "https://example.com", "createdAt": "2026"}},
		{latr.Metadata, map[string]any{"$type": latr.Metadata, "bookmarkUri": "at://did:plc:alice/collection/key", "subject": "https://example.com", "legacyItemUris": []any{"uri", json.Number("42")}}},
	} {
		if validRecordValue(test.value, test.collection) {
			t.Fatalf("malformed %s value accepted: %+v", test.collection, test.value)
		}
	}
}
