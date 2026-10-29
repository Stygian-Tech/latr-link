package server

import (
	"context"
	"strings"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
)

func legacyRecord(v latr.View) map[string]any {
	value := map[string]any{"$type": latr.SavedItem, "subjectUri": v.Value["subject"], "savedAt": v.Value["createdAt"]}
	if tags, ok := v.Value["tags"]; ok {
		value["tags"] = tags
	}
	if v.MetadataRecord != nil {
		for _, key := range []string{"state", "note", "lastOpenedAt"} {
			if x, ok := v.MetadataRecord.Value[key]; ok {
				value[key] = x
			}
		}
	}
	return map[string]any{"uri": v.URI, "cid": v.CID, "value": value}
}
func (s *Server) saveLegacy(ctx context.Context, l latr.Library, subject, web string, isURL bool) (any, error) {
	subject = strings.TrimSpace(subject)
	web = strings.TrimSpace(web)
	if subject == "" {
		return nil, invalid("subjectUri is required")
	}
	kind, storage := "subject", "native"
	var fields *preview.Fields
	if isURL {
		if _, e := latr.NormalizeURL(subject); e != nil {
			return nil, e
		}
		web = subject
		d := s.Preview.Discover(ctx, web)
		fields = s.Preview.Resolve(ctx, web)
		if d.SubjectURI != nil {
			subject = *d.SubjectURI
			if f := s.Preview.Subject(ctx, subject); f != nil {
				if fields != nil {
					*f = preview.Merge(*f, *fields)
				}
				fields = f
			}
		} else {
			kind, storage = "url", "external"
		}
	} else {
		fields = s.Preview.Subject(ctx, subject)
		if web != "" {
			fallback := s.Preview.Resolve(ctx, web)
			if fields == nil {
				fields = fallback
			} else if fallback != nil {
				*fields = preview.Merge(*fields, *fallback)
			}
		}
		if strings.Contains(subject, "/link.latr.saved.external/") || strings.Contains(subject, "/com.latr.saved.external/") {
			storage = "external"
		}
	}
	_, e := l.SaveLegacy(ctx, subject, web, fieldsMap(fields))
	if e != nil {
		return nil, e
	}
	if kind == "url" {
		n, _ := latr.NormalizeURL(subject)
		subject = "at://" + l.Repo.DID() + "/" + latr.External + "/" + latr.RecordKey(n)
	}
	out := map[string]any{"ok": true, "kind": kind, "subjectUri": subject, "storage": storage}
	if web != "" {
		out["linkedWebUrl"] = web
	}
	return out, nil
}
func (s *Server) migrateBookmarks(ctx context.Context, l latr.Library, limit int, cursor string) (any, error) {
	cached := 0
	wrapperSubjects := map[string]string{}
	for _, collection := range []string{latr.External, latr.LegacyExternal, latr.SavedItem, latr.LegacySavedItem} {
		next := ""
		seen := map[string]bool{}
		for {
			page, e := l.Repo.List(ctx, collection, 100, next)
			if e != nil {
				return nil, e
			}
			for _, record := range page.Records {
				v := record.Value
				get := func(k string) string { x, _ := v[k].(string); return x }
				var f preview.Fields
				subject := ""
				if collection == latr.External || collection == latr.LegacyExternal {
					f = preview.Fields{Title: get("title"), Description: get("excerpt"), Image: get("image"), SiteName: get("site"), Author: get("author")}
					subject = strings.TrimSpace(get("url"))
					if !strings.HasPrefix(subject, "http://") && !strings.HasPrefix(subject, "https://") {
						subject = get("normalizedUrl")
					}
					wrapperSubjects[record.URI] = subject
				} else {
					f = preview.Fields{Title: get("previewTitle"), Description: get("previewExcerpt"), Image: get("previewImage"), SiteName: get("previewSite"), Author: get("previewAuthor")}
					if wrapperSubject, ok := wrapperSubjects[get("subjectUri")]; ok {
						// Match the migration's exact bookmark subject, including the
						// original wrapper URL rather than a normalized linked URL.
						subject = wrapperSubject
					} else {
						subject = strings.TrimSpace(get("linkedWebUrl"))
						if !strings.HasPrefix(subject, "http://") && !strings.HasPrefix(subject, "https://") {
							subject = get("subjectUri")
						}
					}
				}
				if hasPreviewSnapshotContent(f) {
					if err := s.durablyCacheMigrationPreview(ctx, subject, f); err != nil {
						return nil, err
					}
					cached++
				}
			}
			if page.Cursor == "" {
				break
			}
			if seen[page.Cursor] {
				return nil, latr.ErrInvalidRecord
			}
			seen[page.Cursor] = true
			next = page.Cursor
		}
	}
	summary, e := l.MigrateBookmarks(ctx, limit, cursor)
	if e != nil {
		return nil, e
	}
	summary.Cached = cached
	return summary, nil
}
