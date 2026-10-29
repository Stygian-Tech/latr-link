package server

import (
	"encoding/json"
	"errors"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"net/http"
	"strconv"
	"strings"
)

func (s *Server) rest(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/latr/")
	developerRoute := strings.HasPrefix(path, "developer/")
	upstream := ""
	if path == "migrate-lexicons" && r.Header.Get("X-ATProto-Upstream-DPoP") == "" {
		var body struct {
			Upstream string `json:"upstreamDpopProof"`
		}
		if e := decode(w, r, &body, false); e != nil {
			respondError(w, e, false)
			return
		}
		upstream = body.Upstream
		if strings.TrimSpace(upstream) == "" {
			respondError(w, problem(400, "missing_upstream_dpop", "Missing upstream DPoP proof pool"), false)
			return
		}
	}
	a, repo, e := s.protected(r, developerRoute, upstream)
	if e != nil {
		respondError(w, e, false)
		return
	}
	var out any
	status := 200
	l := latr.Library{Repo: repo}
	if developerRoute {
		var nsid string
		var in input
		parts := strings.Split(strings.TrimPrefix(path, "developer/"), "/")
		switch {
		case len(parts) == 1 && parts[0] == "usage" && r.Method == "GET":
			nsid = "getUsage"
		case len(parts) == 1 && parts[0] == "clients":
			if r.Method == "GET" {
				nsid = "listClients"
			} else if r.Method == "POST" {
				nsid = "createClient"
				e = decode(w, r, &in, false)
				status = 201
			}
		case len(parts) == 2 && parts[0] == "clients" && r.Method == "DELETE":
			nsid = "deleteClient"
			in.ClientID = parts[1]
		case len(parts) == 3 && parts[0] == "clients" && parts[2] == "keys":
			in.ClientID = parts[1]
			if r.Method == "GET" {
				nsid = "listKeys"
			} else if r.Method == "POST" {
				nsid = "createKey"
				var body struct {
					Label *string `json:"label"`
				}
				e = decode(w, r, &body, false)
				in.Label = body.Label
				status = 201
			}
		case len(parts) == 4 && parts[0] == "clients" && parts[2] == "keys" && r.Method == "DELETE":
			nsid = "revokeKey"
			in.ClientID = parts[1]
			in.KeyID = parts[3]
		}
		if nsid == "" {
			e = problem(404, "not_found", "Not found")
		}
		if e == nil {
			out, e = s.developerOperation(r.Context(), "link.latr.developer."+nsid, a, in, r)
		}
	} else {
		switch {
		case path == "auth/probe" && r.Method == "POST":
			out, e = s.authProbe(r.Context(), a, repo)
		case path == "saves" && r.Method == "GET":
			limit := 100
			cursor := ""
			var page latr.BookmarkPage
			paged := r.URL.Query().Has("limit")
			if paged {
				var parsed int
				parsed, e = strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
				if e != nil || parsed < 1 {
					e = problem(400, "invalid_limit", "invalid limit")
				} else {
					limit = min(parsed, 100)
					cursor = strings.TrimSpace(r.URL.Query().Get("cursor"))
				}
			}
			if e == nil {
				page, e = l.Bookmarks(r.Context(), limit, cursor, "")
			}

			records := []map[string]any{}
			for _, v := range page.Records {
				records = append(records, legacyRecord(v))
			}
			out = map[string]any{"records": records}
			if page.Cursor != "" && paged {
				out.(map[string]any)["cursor"] = page.Cursor
			}
			deprecate(w, "/xrpc/link.latr.bookmarks.listBookmarks")
		case path == "saves/subject" && r.Method == "GET":
			var subject string
			subject, e = required(r, "subjectUri")
			if e == nil {
				v, err := l.Bookmark(r.Context(), subject)
				e = err
				out = map[string]any{}
				if v != nil {
					out.(map[string]any)["record"] = legacyRecord(*v)
				}
			}
			deprecate(w, "/xrpc/link.latr.bookmarks.getBookmark")
		case path == "saves" && r.Method == "POST":
			in, decodeError := decodeRESTSave(w, r)
			e = decodeError
			subject, kind := in.URL, in.Kind
			if kind == "subject" {
				subject = in.SubjectURI
			}

			if e == nil {
				v, err := l.SaveBookmark(r.Context(), subject, nil)
				e = err
				if v != nil {
					savedSubject, _ := v.Value["subject"].(string)
					out = map[string]any{"ok": true, "kind": kind, "subjectUri": savedSubject, "storage": "native"}
					if kind == "url" {
						out.(map[string]any)["linkedWebUrl"] = savedSubject
					} else if in.LinkedWebURL != nil {
						out.(map[string]any)["linkedWebUrl"] = *in.LinkedWebURL
						if f := s.Preview.Resolve(r.Context(), *in.LinkedWebURL); f != nil {
							_ = s.cache(r.Context(), savedSubject, *f)
						}
					}
					s.enrichView(r.Context(), v)
				}
			}
			status = 201
			deprecate(w, "/xrpc/link.latr.bookmarks.saveBookmark")
		case strings.HasPrefix(path, "saves/") && strings.HasSuffix(path, "/state") && r.Method == "PATCH":
			key := strings.TrimSuffix(strings.TrimPrefix(path, "saves/"), "/state")
			var body struct {
				State string `json:"state"`
			}
			e = decode(w, r, &body, false)
			if e == nil {
				if body.State != "unread" && body.State != "archived" {
					e = invalid("Invalid saved state")
				} else {
					e = l.SetState(r.Context(), "at://"+a.DID+"/"+latr.Bookmark+"/"+key, body.State)
					if errors.Is(e, latr.ErrNotFound) {
						e = problem(404, "bookmark_not_found", "Bookmark not found")
					}
				}
			}
			out = ok()
			deprecate(w, "/xrpc/link.latr.bookmarks.setState")
		case strings.HasPrefix(path, "saves/") && r.Method == "DELETE":
			key := strings.TrimPrefix(path, "saves/")
			e = l.RemoveBookmark(r.Context(), "at://"+a.DID+"/"+latr.Bookmark+"/"+key)
			if errors.Is(e, latr.ErrNotFound) {
				e = problem(404, "bookmark_not_found", "Bookmark not found")
			}
			out = ok()
			deprecate(w, "/xrpc/link.latr.bookmarks.deleteBookmark")
		case path == "migrate-lexicons" && r.Method == "POST":
			out, e = s.migrateBookmarks(r.Context(), l, 25, "")
			deprecate(w, "/xrpc/link.latr.bookmarks.migrateLegacy")
		case path == "og-preview" && r.Method == "GET":
			out, e = s.operation(r.Context(), "link.latr.preview.getOpenGraph", a, repo, input{}, r)
		case path == "discover/at-uri" && r.Method == "GET":
			out, e = s.operation(r.Context(), "link.latr.discovery.resolveUrl", a, repo, input{}, r)
		default:
			e = problem(404, "not_found", "Not found")
		}
	}
	if e != nil {
		respondError(w, e, false)
		return
	}
	if !developerRoute && a.ClientID != "" {
		if e = s.Store.RecordUsage(r.Context(), a.ClientID, routeFamily(r.URL.Path)); e != nil {
			respondError(w, e, false)
			return
		}
	}
	jsonResponse(w, status, out)
}

type restSaveInput struct {
	Kind, URL, SubjectURI string
	LinkedWebURL          *string
}

func decodeRESTSave(w http.ResponseWriter, r *http.Request) (restSaveInput, error) {
	var in restSaveInput
	var raw map[string]json.RawMessage
	if e := decode(w, r, &raw, false); e != nil {
		return in, e
	}
	bad := func() (restSaveInput, error) { return in, problem(400, "invalid_json", "Invalid JSON body") }
	if raw == nil {
		return bad()
	}
	required := func(key string, out *string) bool {
		v, ok := raw[key]
		return ok && string(v) != "null" && json.Unmarshal(v, out) == nil
	}
	if !required("kind", &in.Kind) {
		return bad()
	}
	switch in.Kind {
	case "url":
		if _, ok := raw["url"]; !ok {
			return in, problem(400, "missing_url", "missing url")
		}
		if !required("url", &in.URL) {
			return bad()
		}
	case "subject":
		if _, ok := raw["subjectUri"]; !ok {
			return in, problem(400, "missing_subject", "missing subjectUri")
		}
		if !required("subjectUri", &in.SubjectURI) {
			return bad()
		}
		if v, ok := raw["linkedWebUrl"]; ok {
			if e := json.Unmarshal(v, &in.LinkedWebURL); e != nil {
				return bad()
			}
		}
	default:
		return in, problem(400, "invalid_body", "invalid save body")
	}
	return in, nil
}
