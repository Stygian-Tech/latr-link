package preview

import (
	"context"
	"encoding/json"
	"github.com/rivo/uniseg"
	"net/url"
	"strings"
)

type Discovery struct {
	SubjectURI *string `json:"subjectUri,omitempty"`
	Warning    string  `json:"warning,omitempty"`
}

func (r *Resolver) getJSON(ctx context.Context, raw string, target any) bool {
	body, _, e := r.Fetch(ctx, raw, 2*1024*1024, "application/json")
	return e == nil && json.Unmarshal([]byte(body), target) == nil
}
func query(base, method string, q url.Values) string {
	return strings.TrimRight(base, "/") + "/xrpc/" + method + "?" + q.Encode()
}
func (r *Resolver) ResolveActor(ctx context.Context, actor string) string {
	if strings.HasPrefix(actor, "did:") {
		return actor
	}
	var v struct {
		DID string `json:"did"`
	}
	if r.getJSON(ctx, query(r.IdentityURL, "com.atproto.identity.resolveHandle", url.Values{"handle": {actor}}), &v) && strings.HasPrefix(v.DID, "did:") {
		return v.DID
	}
	for _, base := range r.AppViews {
		if r.getJSON(ctx, query(base, "app.bsky.actor.getProfile", url.Values{"actor": {actor}}), &v) && strings.HasPrefix(v.DID, "did:") {
			return v.DID
		}
	}
	return ""
}
func (r *Resolver) Discover(ctx context.Context, raw string) Discovery {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" {
		return Discovery{Warning: "invalid_url"}
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return Discovery{Warning: "unsupported_scheme"}
	}
	if block := BlockingReason(u.Hostname()); block != "" {
		return Discovery{Warning: block}
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if (u.Hostname() == "bsky.app" || u.Hostname() == "www.bsky.app") && len(parts) == 4 && parts[0] == "profile" && parts[2] == "post" && parts[1] != "" && parts[3] != "" {
		if did := r.ResolveActor(ctx, parts[1]); did != "" {
			s := "at://" + did + "/app.bsky.feed.post/" + parts[3]
			return Discovery{SubjectURI: &s}
		}
	}
	markup, _, e := r.Fetch(ctx, raw, 512*1024, "text/html,application/xhtml+xml,*/*")
	if e != nil {
		return Discovery{Warning: e.Error()}
	}
	if s := ExtractAtURI(markup); s != "" {
		return Discovery{SubjectURI: &s}
	}
	return Discovery{}
}
func (r *Resolver) didDocument(ctx context.Context, did string) map[string]any {
	raw := ""
	if strings.HasPrefix(did, "did:plc:") {
		raw = strings.TrimRight(r.PLCURL, "/") + "/" + url.PathEscape(did)
	} else if strings.HasPrefix(did, "did:web:") {
		parts := strings.Split(strings.TrimPrefix(did, "did:web:"), ":")
		host, e := url.PathUnescape(parts[0])
		if e != nil {
			return nil
		}
		raw = "https://" + host + "/.well-known/did.json"
		if len(parts) > 1 {
			raw = "https://" + host + "/" + strings.Join(parts[1:], "/") + "/did.json"
		}
	}
	var doc map[string]any
	if raw != "" && r.getJSON(ctx, raw, &doc) {
		return doc
	}
	return nil
}
func (r *Resolver) publicRecord(ctx context.Context, did, collection, key string) map[string]any {
	doc := r.didDocument(ctx, did)
	services, _ := doc["service"].([]any)
	for _, s := range services {
		m, _ := s.(map[string]any)
		id, _ := m["id"].(string)
		typ, _ := m["type"].(string)
		if typ == "AtprotoPersonalDataServer" && (id == "#atproto_pds" || id == did+"#atproto_pds") {
			base, _ := m["serviceEndpoint"].(string)
			var result struct{ Value map[string]any }
			if base != "" && r.getJSON(ctx, query(base, "com.atproto.repo.getRecord", url.Values{"repo": {did}, "collection": {collection}, "rkey": {key}}), &result) {
				return result.Value
			}
		}
	}
	return nil
}
func field(m map[string]any, key string) string { v, _ := m[key].(string); return v }
func (r *Resolver) Subject(ctx context.Context, subject string) *Fields {
	subject = strings.TrimSpace(subject)
	parts := strings.SplitN(strings.TrimPrefix(subject, "at://"), "/", 3)
	if !strings.HasPrefix(subject, "at://") || len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil
	}
	did, collection, key := parts[0], parts[1], parts[2]
	if collection == "app.bsky.feed.post" {
		bases := []string{}
		doc := r.didDocument(ctx, did)
		services, _ := doc["service"].([]any)
		for _, s := range services {
			m, _ := s.(map[string]any)
			id := field(m, "id")
			typ := field(m, "type")
			if (strings.HasSuffix(id, "#bsky_appview") || strings.HasSuffix(id, "#atproto_appview")) && (typ == "BskyAppView" || typ == "AtprotoAppView") {
				if base := field(m, "serviceEndpoint"); base != "" {
					bases = append(bases, base)
				}
			}
		}
		bases = append(bases, r.AppViews...)
		seen := map[string]bool{}
		for _, base := range bases {
			if seen[base] {
				continue
			}
			seen[base] = true
			var result struct{ Posts []map[string]any }
			if r.getJSON(ctx, query(base, "app.bsky.feed.getPosts", url.Values{"uris[0]": {subject}}), &result) && len(result.Posts) > 0 {
				post := result.Posts[0]
				record, _ := post["record"].(map[string]any)
				a, _ := post["author"].(map[string]any)
				embed, _ := post["embed"].(map[string]any)
				f := bskyPostFields(field(record, "text"), field(a, "handle"), field(embed, "thumb"))
				if imgs, ok := embed["images"].([]any); ok && len(imgs) > 0 {
					img, _ := imgs[0].(map[string]any)
					f.Image = field(img, "fullsize")
				}
				if f.HasContent() {
					return &f
				}
			}
		}
	}
	value := r.publicRecord(ctx, did, collection, key)
	if value == nil {
		return nil
	}
	f := Fields{}
	switch {
	case collection == "app.bsky.feed.post":
		f = bskyPostFields(field(value, "text"), "", "")
	case collection == "link.latr.saved.external" || collection == "com.latr.saved.external":
		f = Fields{Title: strings.TrimSpace(field(value, "title")), Description: strings.TrimSpace(field(value, "excerpt")), Image: strings.TrimSpace(field(value, "image")), SiteName: strings.TrimSpace(field(value, "site")), Author: strings.TrimSpace(field(value, "author"))}
	default:
		f.Title = strings.TrimSpace(field(value, "title"))
		if f.Title == "" {
			f.Title = postTitle(field(value, "text"))
		}
		if f.Title == "" {
			f.Title = strings.TrimSpace(field(value, "name"))
		}
	}
	if f.HasContent() {
		return &f
	}
	return nil
}

func postTitle(text string) string {
	// LatrKit truncates at 160 extended grapheme clusters, not bytes or runes.
	clusters := uniseg.NewGraphemes(text)
	var title strings.Builder
	for count := 0; count < 160 && clusters.Next(); count++ {
		title.WriteString(clusters.Str())
	}
	return strings.TrimSpace(title.String())
}
func bskyPostFields(text, handle, image string) Fields {
	handle = strings.TrimSpace(handle)
	f := Fields{Title: postTitle(text), Image: strings.TrimSpace(image)}
	if handle != "" {
		f.Author = "@" + strings.TrimPrefix(handle, "@")
		f.SiteName = strings.TrimPrefix(handle, "@")
	}
	return f
}
