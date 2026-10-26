package server

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/auth"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
)

type method struct {
	verb      string
	query     []string
	developer bool
}

var methods = map[string]method{
	"link.latr.bookmarks.listBookmarks": {"GET", []string{"limit", "cursor", "tag"}, false}, "link.latr.bookmarks.listTags": {"GET", []string{"limit", "cursor"}, false}, "link.latr.bookmarks.getBookmark": {"GET", []string{"subject"}, false},
	"link.latr.bookmarks.saveBookmark": {"POST", nil, false}, "link.latr.bookmarks.syncMetadata": {"POST", nil, false}, "link.latr.bookmarks.setState": {"PATCH", nil, false}, "link.latr.bookmarks.setTags": {"POST", nil, false}, "link.latr.bookmarks.renameTag": {"POST", nil, false}, "link.latr.bookmarks.deleteTag": {"POST", nil, false}, "link.latr.bookmarks.deleteBookmark": {"POST", nil, false}, "link.latr.bookmarks.migrateLegacy": {"POST", nil, false},
	"link.latr.saved.listItems": {"GET", []string{"limit", "cursor"}, false}, "link.latr.saved.getItem": {"GET", []string{"subjectUri"}, false}, "link.latr.saved.saveUrl": {"POST", nil, false}, "link.latr.saved.saveSubject": {"POST", nil, false}, "link.latr.saved.setState": {"POST", nil, false}, "link.latr.saved.deleteItem": {"POST", nil, false}, "link.latr.saved.migrateLegacy": {"POST", nil, false},
	"link.latr.preview.getOpenGraph": {"GET", []string{"url"}, false}, "link.latr.discovery.resolveUrl": {"GET", []string{"url"}, false}, "link.latr.auth.probe": {"GET", []string{}, false},
	"link.latr.developer.listClients": {"GET", []string{}, true}, "link.latr.developer.createClient": {"POST", nil, true}, "link.latr.developer.deleteClient": {"POST", nil, true}, "link.latr.developer.listKeys": {"GET", []string{"clientId"}, true}, "link.latr.developer.createKey": {"POST", nil, true}, "link.latr.developer.revokeKey": {"POST", nil, true}, "link.latr.developer.getUsage": {"GET", []string{}, true},
}

type input struct {
	Subject      string   `json:"subject"`
	Tags         []string `json:"tags"`
	BookmarkURI  string   `json:"bookmarkUri"`
	State        string   `json:"state"`
	Tag          string   `json:"tag"`
	Replacement  string   `json:"replacement"`
	Limit        *int     `json:"limit"`
	Cursor       string   `json:"cursor"`
	Upstream     string   `json:"upstreamDpopProof"`
	URL          string   `json:"url"`
	SubjectURI   string   `json:"subjectUri"`
	LinkedWebURL string   `json:"linkedWebUrl"`
	ItemRkey     string   `json:"itemRkey"`
	ClientID     string   `json:"clientId"`
	DisplayName  *string  `json:"displayName"`
	Label        *string  `json:"label"`
	KeyID        string   `json:"keyId"`
}

var inputKeys = map[string][]string{"saveBookmark": {"subject", "tags"}, "syncMetadata": {"limit", "cursor"}, "setState": {"bookmarkUri", "state"}, "setTags": {"bookmarkUri", "tags"}, "renameTag": {"tag", "replacement", "limit", "cursor"}, "deleteTag": {"tag", "limit", "cursor"}, "deleteBookmark": {"bookmarkUri"}, "migrateLegacy": {"limit", "cursor", "upstreamDpopProof"}, "saveUrl": {"url"}, "saveSubject": {"subjectUri", "linkedWebUrl"}, "deleteItem": {"itemRkey"}, "createClient": {"clientId", "displayName"}, "deleteClient": {"clientId"}, "createKey": {"clientId", "label"}, "revokeKey": {"clientId", "keyId"}}

func decodeInput(w http.ResponseWriter, r *http.Request, nsid string) (input, error) {
	var v input
	var raw map[string]any
	if e := decode(w, r, &raw, true); e != nil {
		return v, e
	}
	if raw == nil {
		return v, invalid("JSON input must be an object")
	}
	name := nsid[strings.LastIndex(nsid, ".")+1:]
	keys := inputKeys[name]
	if nsid == "link.latr.saved.setState" {
		keys = []string{"itemRkey", "state"}
	}
	if nsid == "link.latr.saved.migrateLegacy" {
		keys = []string{}
	}
	for k := range raw {
		found := false
		for _, a := range keys {
			if k == a {
				found = true
			}
		}
		if !found {
			return v, invalid("Unknown input field: " + k)
		}
	}
	if e := convertInput(raw, &v); e != nil {
		return v, e
	}
	requiredKeys := map[string][]string{"saveBookmark": {"subject"}, "setState": {"bookmarkUri", "state"}, "setTags": {"bookmarkUri", "tags"}, "renameTag": {"tag", "replacement"}, "deleteTag": {"tag"}, "deleteBookmark": {"bookmarkUri"}, "saveUrl": {"url"}, "saveSubject": {"subjectUri"}, "deleteItem": {"itemRkey"}, "createClient": {"clientId"}, "deleteClient": {"clientId"}, "createKey": {"clientId"}, "revokeKey": {"clientId", "keyId"}}
	req := requiredKeys[name]
	if nsid == "link.latr.saved.setState" {
		req = []string{"itemRkey", "state"}
	}
	for _, key := range req {
		value, exists := raw[key]
		if !exists || value == nil {
			return v, invalid(key + " is required")
		}
	}
	return v, nil
}
func (s *Server) xrpc(w http.ResponseWriter, r *http.Request) {
	nsid := strings.TrimPrefix(r.URL.Path, "/xrpc/")
	spec, known := methods[nsid]
	if !known {
		respondError(w, problem(404, "xrpc_not_supported", "Unknown XRPC method"), true)
		return
	}
	if r.Method != spec.verb {
		respondError(w, problem(405, "invalid_request", "Method not allowed"), true)
		return
	}
	var in input
	var e error
	// Migration accepts its upstream proof pool in the body before authentication.
	// Every other registered route authenticates before decoding its request.
	migration := nsid == "link.latr.bookmarks.migrateLegacy"
	if migration {
		in, e = decodeInput(w, r, nsid)
		if e != nil {
			respondError(w, e, true)
			return
		}
	}
	a, repo, e := s.protected(r, spec.developer, in.Upstream)
	if e != nil {
		respondError(w, e, true)
		return
	}
	if !migration {
		if r.Method == "GET" {
			e = validateQuery(r, spec.query...)
		} else {
			in, e = decodeInput(w, r, nsid)
		}
	}
	if e != nil {
		respondError(w, e, true)
		return
	}
	var out any
	if spec.developer {
		out, e = s.developerOperation(r.Context(), nsid, a, in, r)
	} else {
		out, e = s.operation(r.Context(), nsid, a, repo, in, r)
	}
	if e != nil {
		respondError(w, e, true)
		return
	}
	if !spec.developer && a.ClientID != "" {
		if e = s.Store.RecordUsage(r.Context(), a.ClientID, routeFamily(r.URL.Path)); e != nil {
			respondError(w, e, true)
			return
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	jsonResponse(w, 200, out)
}
func (s *Server) operation(ctx context.Context, nsid string, a auth.Context, repo Repository, in input, r *http.Request) (any, error) {
	l := latr.Library{Repo: repo}
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	switch nsid {
	case "link.latr.bookmarks.listBookmarks":
		limit, e := intParam(r, "limit", 50, 1, 100)
		if e != nil {
			return nil, e
		}
		tag := r.URL.Query().Get("tag")
		if _, present := r.URL.Query()["tag"]; present {
			if _, e = latr.NormalizeTag(tag); e != nil {
				return nil, invalid(e.Error())
			}
		}
		p, e := l.Bookmarks(ctx, limit, cursor, tag)
		if e != nil {
			return nil, e
		}
		for i := range p.Records {
			s.enrichView(ctx, &p.Records[i])
		}
		out := map[string]any{"bookmarks": p.Records}
		if p.Cursor != "" {
			out["cursor"] = p.Cursor
		}
		return out, nil
	case "link.latr.bookmarks.listTags":
		limit, e := intParam(r, "limit", 100, 1, 100)
		if e != nil {
			return nil, e
		}
		return l.Tags(ctx, limit, cursor)
	case "link.latr.bookmarks.getBookmark":
		subject, e := required(r, "subject")
		if e != nil {
			return nil, e
		}
		v, e := l.Bookmark(ctx, subject)
		if e != nil {
			return nil, e
		}
		s.enrichView(ctx, v)
		out := map[string]any{}
		if v != nil {
			out["bookmark"] = v
		}
		return out, nil
	case "link.latr.bookmarks.saveBookmark":
		if _, e := latr.NormalizeTags(in.Tags); e != nil {
			return nil, invalid(e.Error())
		}
		v, e := l.SaveBookmark(ctx, in.Subject, in.Tags)
		if e != nil {
			return nil, e
		}
		s.enrichView(ctx, v)
		return v, nil
	case "link.latr.bookmarks.setTags":
		if _, e := latr.NormalizeTags(in.Tags); e != nil {
			return nil, invalid(e.Error())
		}
		v, e := l.SetTags(ctx, in.BookmarkURI, in.Tags)
		if e != nil {
			return nil, e
		}
		s.enrichView(ctx, v)
		return v, nil
	case "link.latr.bookmarks.setState":
		if in.State != "unread" && in.State != "archived" {
			return nil, invalid("Invalid bookmark state")
		}
		e := l.SetState(ctx, in.BookmarkURI, in.State)
		return ok(), e
	case "link.latr.bookmarks.deleteBookmark":
		e := l.RemoveBookmark(ctx, in.BookmarkURI)
		return ok(), e
	case "link.latr.bookmarks.syncMetadata":
		limit, e := bounded(in.Limit, 50, 1, 100)
		if e != nil {
			return nil, e
		}
		return l.SyncMetadata(ctx, limit, in.Cursor)
	case "link.latr.bookmarks.renameTag", "link.latr.bookmarks.deleteTag":
		limit, e := bounded(in.Limit, 25, 1, 25)
		if e != nil {
			return nil, e
		}
		source, e := latr.NormalizeTag(in.Tag)
		if e != nil {
			return nil, invalid(e.Error())
		}
		target := ""
		if strings.HasSuffix(nsid, "renameTag") {
			target, e = latr.NormalizeTag(in.Replacement)
			if e != nil || target == source {
				return nil, invalid("Replacement tag must be valid and differ from the source tag")
			}
		}
		return l.MutateTag(ctx, source, target, limit, in.Cursor)
	case "link.latr.bookmarks.migrateLegacy":
		limit := 25
		if in.Limit != nil {
			limit = *in.Limit
		}
		return s.migrateBookmarks(ctx, l, limit, in.Cursor)
	case "link.latr.auth.probe":
		return s.authProbe(ctx, a, repo)
	case "link.latr.preview.getOpenGraph":
		raw, e := required(r, "url")
		if e != nil {
			return nil, e
		}
		if _, e = latr.NormalizeURL(raw); e != nil {
			return nil, e
		}
		f := s.Preview.Resolve(ctx, raw)
		if f == nil {
			return nil, problem(502, "og_fetch_failed", "Could not fetch Open Graph metadata")
		}
		return f, nil
	case "link.latr.discovery.resolveUrl":
		raw, e := required(r, "url")
		if e != nil {
			return nil, e
		}
		return s.Preview.Discover(ctx, raw), nil
	case "link.latr.saved.listItems":
		limit, e := intParam(r, "limit", 100, 1, 100)
		if e != nil {
			return nil, e
		}
		return l.SavedItems(ctx, limit, cursor)
	case "link.latr.saved.getItem":
		subject, e := required(r, "subjectUri")
		if e != nil {
			return nil, e
		}
		v, e := repo.Get(ctx, latr.SavedItem, latr.RecordKey(subject), !a.AccessTokenSignatureVerified)
		out := map[string]any{}
		if v != nil {
			out["record"] = v
		}
		return out, e
	case "link.latr.saved.saveUrl":
		return s.saveLegacy(ctx, l, in.URL, "", true)
	case "link.latr.saved.saveSubject":
		return s.saveLegacy(ctx, l, in.SubjectURI, in.LinkedWebURL, false)
	case "link.latr.saved.setState":
		if strings.TrimSpace(in.ItemRkey) == "" || in.State != "unread" && in.State != "archived" {
			return nil, invalid("Invalid saved item state")
		}
		e := l.SetLegacyState(ctx, strings.TrimSpace(in.ItemRkey), in.State)
		if errors.Is(e, latr.ErrNotFound) {
			e = problem(404, "saved_item_not_found", "Saved item not found")
		}
		return ok(), e
	case "link.latr.saved.deleteItem":
		if strings.TrimSpace(in.ItemRkey) == "" {
			return nil, invalid("itemRkey is required")
		}
		e := l.RemoveLegacyItem(ctx, strings.TrimSpace(in.ItemRkey))
		if errors.Is(e, latr.ErrNotFound) {
			e = problem(404, "saved_item_not_found", "Saved item not found")
		}
		return ok(), e
	case "link.latr.saved.migrateLegacy":
		v, e := l.MigrateLexicons(ctx)
		return map[string]any{"ok": true, "externalCopied": v.ExternalCopied, "itemsCopied": v.ItemsCopied, "externalDeleted": v.ExternalDeleted, "itemsDeleted": v.ItemsDeleted}, e
	}
	return nil, invalid("Unknown operation")
}
