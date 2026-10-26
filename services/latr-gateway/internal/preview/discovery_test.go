package preview

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(r *http.Request, code int, body string) *http.Response {
	return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header), Request: r}
}
func testResolver(t *testing.T, handler func(*http.Request) *http.Response) *Resolver {
	t.Helper()
	return New(&http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) { return handler(r), nil })}, "https://plc.example", []string{"https://appview.example"}, "https://identity.example")
}
func TestSubjectPinnedContract(t *testing.T) {
	for _, collection := range []string{"link.latr.saved.external", "com.latr.saved.external", "app.bsky.feed.post", "site.standard.document"} {
		t.Run(collection, func(t *testing.T) {
			r := testResolver(t, func(req *http.Request) *http.Response {
				switch req.URL.Host {
				case "plc.example":
					return response(req, 200, `{"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"},{"id":"#bsky_appview","type":"BskyAppView","serviceEndpoint":"https://discovered.example"}]}`)
				case "discovered.example":
					return response(req, 200, `{"posts":[{"record":{"text":"Hello Bluesky"},"author":{"handle":"alice.bsky.social"},"embed":{"images":[{"fullsize":"https://cdn.example/thumb.jpg"}]}}]}`)
				case "pds.example":
					if req.URL.Query().Get("rkey") != "key/with/slash" {
						t.Error("record key not preserved")
					}
					return response(req, 200, `{"value":{"title":"Article","excerpt":"Summary","description":"Wrong field","site":"Example","image":"https://example.com/thumb.png","author":"Ada"}}`)
				default:
					t.Errorf("unexpected fallback request %s", req.URL)
					return response(req, 500, "")
				}
			})
			got := r.Subject(context.Background(), "at://did:plc:test/"+collection+"/key/with/slash")
			want := Fields{Title: "Article"}
			switch collection {
			case "app.bsky.feed.post":
				want = Fields{Title: "Hello Bluesky", Author: "@alice.bsky.social", SiteName: "alice.bsky.social", Image: "https://cdn.example/thumb.jpg"}
			case "link.latr.saved.external", "com.latr.saved.external":
				want = Fields{Title: "Article", Description: "Summary", SiteName: "Example", Image: "https://example.com/thumb.png", Author: "Ada"}
			}
			if got == nil || *got != want {
				t.Fatalf("got %#v, want %#v", got, want)
			}
		})
	}
}
func TestSubjectTitleUsesGraphemePrefix(t *testing.T) {
	f := bskyPostFields(strings.Repeat("👨‍👩‍👧‍👦", 170), "@alice.example", "")
	if f.Title != strings.Repeat("👨‍👩‍👧‍👦", 160) || f.Description != "" || f.Author != "@alice.example" || f.SiteName != "alice.example" {
		t.Fatalf("unexpected post fields %#v", f)
	}
}
func TestAppViewFallsBackToPDS(t *testing.T) {
	r := testResolver(t, func(req *http.Request) *http.Response {
		switch req.URL.Host {
		case "plc.example":
			return response(req, 200, `{"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}`)
		case "appview.example":
			return response(req, 503, "")
		case "pds.example":
			return response(req, 200, `{"value":{"text":"Public PDS post"}}`)
		default:
			t.Fatalf("unexpected request %s", req.URL)
			return nil
		}
	})
	if got := r.Subject(context.Background(), "at://did:plc:test/app.bsky.feed.post/key"); got == nil || *got != (Fields{Title: "Public PDS post"}) {
		t.Fatalf("PDS fallback %#v", got)
	}
}
func TestGenericSubjectFallbackNames(t *testing.T) {
	for _, tt := range []struct{ record, want string }{{`{"text":"Fallback text","name":"Fallback name"}`, "Fallback text"}, {`{"name":"Fallback name"}`, "Fallback name"}} {
		r := testResolver(t, func(req *http.Request) *http.Response {
			if req.URL.Host == "plc.example" {
				return response(req, 200, `{"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}`)
			}
			return response(req, 200, `{"value":`+tt.record+`}`)
		})
		got := r.Subject(context.Background(), "at://did:plc:test/site.standard.document/key")
		if got == nil || got.Title != tt.want {
			t.Fatalf("generic %#v", got)
		}
	}
}
func TestDiscoverBlueskyAndNativeHead(t *testing.T) {
	r := testResolver(t, func(req *http.Request) *http.Response {
		if req.URL.Host == "identity.example" {
			if req.URL.Query().Get("handle") != "alice.example" {
				t.Fatal("wrong actor")
			}
			return response(req, 200, `{"did":"did:plc:alice"}`)
		}
		return response(req, 200, `<head><link href="at://did:plc:owner/link.latr.saved.external/wrapper"><meta content="at://did:plc:writer/site.standard.document/native"></head><body><meta content="at://did:plc:other/site.standard.document/body"></body>`)
	})
	got := r.Discover(context.Background(), "https://bsky.app/profile/alice.example/post/key")
	if got.SubjectURI == nil || *got.SubjectURI != "at://did:plc:alice/app.bsky.feed.post/key" {
		t.Fatalf("Bluesky %#v", got)
	}
	got = r.Discover(context.Background(), "https://publication.example/article")
	if got.SubjectURI == nil || *got.SubjectURI != "at://did:plc:writer/site.standard.document/native" {
		t.Fatalf("head %#v", got)
	}
}
func TestDiscoveryIgnoresBodyAndMalformedURIs(t *testing.T) {
	if ExtractAtURI(`<head><meta content="at://incomplete"></head><body><link href="at://did:plc:body/site.standard.document/key"></body>`) != "" {
		t.Fatal("body metadata escaped head boundary")
	}
	for _, raw := range []string{"at:///collection/key", "at://repo//key", "at://repo/collection/", "https://example.com"} {
		if CanonicalAtURI(raw) != "" {
			t.Errorf("accepted %q", raw)
		}
	}
	want := "at://did:plc:owner/link.latr.saved.external/key"
	if got := ExtractAtURI(`<head><link href="` + want + `"></head>`); got != want {
		t.Fatalf("wrapper-only fallback %q", got)
	}
}
func TestBlockedTargetsAndRedirectsNeverFetchPrivateHost(t *testing.T) {
	for _, host := range []string{"localhost", "127.0.0.1", "0.1.2.3", "10.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"} {
		if BlockingReason(host) == "" {
			t.Errorf("private host accepted %q", host)
		}
	}
	for _, host := range []string{"example.com", "8.8.8.8", "2606:4700:4700::1111"} {
		if BlockingReason(host) != "" {
			t.Errorf("public host blocked %q", host)
		}
	}
	requests := 0
	r := testResolver(t, func(req *http.Request) *http.Response {
		requests++
		resp := response(req, 302, "")
		resp.Header.Set("Location", "http://169.254.169.254/latest/meta-data/")
		return resp
	})
	if _, _, err := r.Fetch(context.Background(), "https://public.example/article", 1024, "text/html"); err == nil || !strings.Contains(err.Error(), "blocked_redirect") {
		t.Fatalf("redirect error %v", err)
	}
	if requests != 1 {
		t.Fatalf("made %d requests", requests)
	}
	if _, _, err := r.Fetch(context.Background(), "http://127.0.0.1/", 1024, "text/html"); err == nil {
		t.Fatal("private target accepted")
	}
	if requests != 1 {
		t.Fatal("private target reached network")
	}
}
func TestResolveMergesBestProviderAndPreservesDirectFallback(t *testing.T) {
	r := testResolver(t, func(req *http.Request) *http.Response {
		switch req.URL.Host {
		case "article.example":
			return response(req, 200, `<head><title>article.example</title><meta name="author" content="Ada"></head>`)
		case "api.microlink.io":
			return response(req, 200, `{"status":"success","data":{"title":"Authored headline","image":{"url":"https://cdn.example/hero.jpg"}}}`)
		default:
			return response(req, 503, "")
		}
	})
	got := r.Resolve(context.Background(), "https://article.example/a-slug")
	if got == nil || got.Title != "Authored headline" || got.Image != "https://cdn.example/hero.jpg" || got.Author != "Ada" {
		t.Fatalf("provider merge %#v", got)
	}
}

func TestBlockingReasonCompatibility(t *testing.T) {
	for host, want := range map[string]string{"localhost": "blocked_host", "127.0.0.1": "blocked_ipv4", "0.1.2.3": "blocked_ipv4", "::1": "blocked_host", "fd00::1": "blocked_ipv6_scope"} {
		if got := BlockingReason(host); got != want {
			t.Errorf("%s: got %s, want %s", host, got, want)
		}
	}
}
