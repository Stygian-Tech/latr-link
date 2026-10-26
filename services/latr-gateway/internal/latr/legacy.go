package latr

import (
	"context"
	"errors"
	"github.com/rivo/uniseg"
	"strings"
	"time"
)

func (l Library) SavedItems(ctx context.Context, limit int, cursor string) (Page, error) {
	return l.Repo.List(ctx, SavedItem, clamp(limit, 100), cursor)
}
func (l Library) LegacyItem(ctx context.Context, key string) (*Record, error) {
	return l.Repo.Get(ctx, SavedItem, key, false)
}

// SaveLegacy retains the saved.* adapter for existing clients. New saves use SaveBookmark.
func (l Library) SaveLegacy(ctx context.Context, subject, webURL string, preview map[string]any) (string, error) {
	if strings.HasPrefix(subject, "http://") || strings.HasPrefix(subject, "https://") {
		normalized, e := NormalizeURL(subject)
		if e != nil {
			return "", e
		}
		k := RecordKey(normalized)
		wrapper, e := l.Repo.Get(ctx, External, k, false)
		if e != nil {
			return "", e
		}
		v := map[string]any{"$type": External, "url": subject, "normalizedUrl": normalized, "fingerprint": Fingerprint(normalized), "createdAt": time.Now().UTC().Format(time.RFC3339Nano)}
		if wrapper != nil {
			v = clone(wrapper.Value)
		}
		mergePreview(v, preview, false)
		w := Create(External, k, v)
		if wrapper != nil {
			w = Update(External, k, v, wrapper.CID)
		}
		if e = l.Repo.Apply(ctx, []Write{w}); e != nil {
			return "", e
		}
		subject = "at://" + l.Repo.DID() + "/" + External + "/" + k
		webURL = normalized
	}
	if webURL = strings.TrimSpace(webURL); webURL != "" {
		if normalized, err := NormalizeURL(webURL); err == nil {
			webURL = normalized
		}
	}
	k := RecordKey(subject)
	current, e := l.Repo.Get(ctx, SavedItem, k, false)
	if e != nil {
		return "", e
	}
	v := map[string]any{"$type": SavedItem, "subjectUri": subject, "savedAt": time.Now().UTC().Format(time.RFC3339Nano)}
	if current != nil {
		v = clone(current.Value)
	}
	v["state"] = "unread"
	if webURL != "" {
		v["linkedWebUrl"] = webURL
	}
	mergePreview(v, preview, true)
	w := Create(SavedItem, k, v)
	if current != nil {
		w = Update(SavedItem, k, v, current.CID)
	}
	if e = l.Repo.Apply(ctx, []Write{w}); e != nil {
		return "", e
	}
	return "at://" + l.Repo.DID() + "/" + SavedItem + "/" + k, nil
}
func mergePreview(v, preview map[string]any, item bool) {
	for _, field := range []struct {
		source, target string
		limit          int
	}{{"title", "title", 2048}, {"description", "excerpt", 8192}, {"image", "image", 0}, {"siteName", "site", 512}, {"author", "author", 512}} {
		target := field.target
		if item {
			target = "preview" + strings.ToUpper(target[:1]) + target[1:]
		}
		if strings.TrimSpace(text(v, target)) != "" {
			continue
		}
		value, ok := preview[field.source].(string)
		if !ok {
			continue
		}
		if field.limit > 0 {
			g := uniseg.NewGraphemes(value)
			end := 0
			for i := 0; i < field.limit && g.Next(); i++ {
				_, end = g.Positions()
			}
			value = value[:end]
		}
		v[target] = value
	}
}

func (l Library) SetLegacyState(ctx context.Context, key, state string) error {
	if state != "unread" && state != "archived" {
		return invalidRequest("Invalid saved state")
	}
	return l.legacyMutation(ctx, key, func(r Record) Write { v := clone(r.Value); v["state"] = state; return Update(SavedItem, key, v, r.CID) })
}
func (l Library) RemoveLegacyItem(ctx context.Context, key string) error {
	return l.legacyMutation(ctx, key, func(r Record) Write { return Delete(SavedItem, key, r.CID) })
}
func (l Library) legacyMutation(ctx context.Context, key string, transform func(Record) Write) error {
	for attempt := 0; attempt < 2; attempt++ {
		r, e := l.Repo.Get(ctx, SavedItem, key, false)
		if e != nil {
			return e
		}
		if r == nil {
			return ErrNotFound
		}
		e = l.Repo.Apply(ctx, []Write{transform(*r)})
		if errors.Is(e, ErrConflict) && attempt == 0 {
			continue
		}
		return e
	}
	return ErrConflict
}

type LexiconMigrationSummary struct {
	ExternalCopied  int `json:"externalCopied"`
	ItemsCopied     int `json:"itemsCopied"`
	ExternalDeleted int `json:"externalDeleted"`
	ItemsDeleted    int `json:"itemsDeleted"`
}

func (l Library) MigrateLexicons(ctx context.Context) (LexiconMigrationSummary, error) {
	out := LexiconMigrationSummary{}
	for _, pair := range [][2]string{{LegacyExternal, External}, {LegacySavedItem, SavedItem}} {
		records, e := l.all(ctx, pair[0])
		if e != nil {
			return out, e
		}
		for _, r := range records {
			_, _, key, e := ParseURI(r.URI)
			if e != nil {
				return out, e
			}
			existing, e := l.Repo.Get(ctx, pair[1], key, false)
			if e != nil {
				return out, e
			}
			writes := []Write{}
			if existing == nil {
				v := clone(r.Value)
				v["$type"] = pair[1]
				if pair[1] == SavedItem {
					v["subjectUri"] = strings.Replace(text(v, "subjectUri"), "at://"+l.Repo.DID()+"/"+LegacyExternal+"/", "at://"+l.Repo.DID()+"/"+External+"/", 1)
				}
				writes = append(writes, Create(pair[1], key, v))
			}
			writes = append(writes, Delete(pair[0], key, r.CID))
			if e = l.Repo.Apply(ctx, writes); e != nil {
				return out, e
			}
			if pair[1] == External {
				out.ExternalDeleted++
				if existing == nil {
					out.ExternalCopied++
				}
			} else {
				out.ItemsDeleted++
				if existing == nil {
					out.ItemsCopied++
				}
			}
		}
	}
	return out, nil
}
