package latr

import (
	"context"
	"slices"
	"sort"
	"strings"
	"time"
)

func metadataMatches(m *Record, b Record) bool {
	return m != nil && text(m.Value, "bookmarkUri") == b.URI && text(m.Value, "subject") == text(b.Value, "subject")
}
func (l Library) view(ctx context.Context, b Record) (View, error) {
	k, e := l.key(b.URI, Bookmark)
	if e != nil {
		return View{}, ErrInvalidRecord
	}
	m, e := l.Repo.Get(ctx, Metadata, k, false)
	if e != nil {
		return View{}, e
	}
	if !metadataMatches(m, b) {
		m = nil
	}
	return View{URI: b.URI, CID: b.CID, Value: b.Value, MetadataRecord: m}, nil
}
func (l Library) Bookmark(ctx context.Context, raw string) (*View, error) {
	subject, e := Subject(raw)
	if e != nil {
		return nil, e
	}
	records, e := l.all(ctx, Bookmark)
	if e != nil {
		return nil, e
	}
	var matches []Record
	for _, r := range records {
		if text(r.Value, "subject") == subject {
			matches = append(matches, r)
		}
	}
	if len(matches) == 0 {
		return nil, nil
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := text(matches[i].Value, "createdAt"), text(matches[j].Value, "createdAt")
		if a != b {
			return a < b
		}
		return matches[i].URI < matches[j].URI
	})
	v, e := l.view(ctx, matches[0])
	return &v, e
}
func (l Library) Bookmarks(ctx context.Context, limit int, cursor, tag string) (BookmarkPage, error) {
	if tag != "" {
		var e error
		tag, e = NormalizeTag(tag)
		if e != nil {
			return BookmarkPage{}, e
		}
	}
	p, e := l.Repo.List(ctx, Bookmark, clamp(limit, 100), cursor)
	if e != nil {
		return BookmarkPage{}, e
	}
	metadata, e := l.all(ctx, Metadata)
	if e != nil {
		return BookmarkPage{}, e
	}
	byKey := map[string]*Record{}
	for i := range metadata {
		if k, e := l.key(metadata[i].URI, Metadata); e == nil {
			byKey[k] = &metadata[i]
		}
	}
	out := BookmarkPage{Records: []View{}, Cursor: p.Cursor}
	for _, r := range p.Records {
		if tag != "" && !contains(tags(r.Value), tag) {
			continue
		}
		k, e := l.key(r.URI, Bookmark)
		if e != nil {
			return out, ErrInvalidRecord
		}
		m := byKey[k]
		if !metadataMatches(m, r) {
			m = nil
		}
		out.Records = append(out.Records, View{URI: r.URI, CID: r.CID, Value: r.Value, MetadataRecord: m})
	}
	return out, nil
}
func newMetadata(uri, subject, state string) map[string]any {
	return map[string]any{"$type": Metadata, "bookmarkUri": uri, "subject": subject, "state": state}
}
func (l Library) SaveBookmark(ctx context.Context, raw string, rawTags []string) (*View, error) {
	subject, e := Subject(raw)
	if e != nil {
		return nil, e
	}
	var t []string
	if rawTags != nil {
		t, e = NormalizeTags(rawTags)
		if e != nil {
			return nil, e
		}
	}
	existing, e := l.Bookmark(ctx, subject)
	if e != nil {
		return nil, e
	}
	writes := []Write{}
	if existing != nil {
		k, _ := l.key(existing.URI, Bookmark)
		if rawTags != nil {
			existingTags, e := NormalizeTags(tags(existing.Value))
			if e != nil {
				return nil, e
			}
			merged, e := NormalizeTags(unique(append(append([]string{}, existingTags...), t...)))
			if e != nil {
				return nil, e
			}
			if !slices.Equal(merged, tags(existing.Value)) {
				v := clone(existing.Value)
				setTags(v, merged)
				writes = append(writes, Update(Bookmark, k, v, existing.CID))
			}
		}
		if existing.MetadataRecord == nil {
			writes = append(writes, Create(Metadata, k, newMetadata(existing.URI, subject, "unread")))
		}
	} else {
		k := NewTID()
		uri := "at://" + l.Repo.DID() + "/" + Bookmark + "/" + k
		v := map[string]any{"$type": Bookmark, "subject": subject, "createdAt": time.Now().UTC().Format(time.RFC3339Nano)}
		setTags(v, t)
		writes = append(writes, Create(Bookmark, k, v), Create(Metadata, k, newMetadata(uri, subject, "unread")))
	}
	if len(writes) > 0 {
		if e = l.Repo.Apply(ctx, writes); e != nil {
			return nil, e
		}
	}
	result, err := l.Bookmark(ctx, subject)
	if err == nil && result == nil {
		return nil, ErrInvalidRecord
	}
	return result, err
}
func (l Library) SetTags(ctx context.Context, uri string, raw []string) (*View, error) {
	t, e := NormalizeTags(raw)
	if e != nil {
		return nil, e
	}
	k, e := l.key(uri, Bookmark)
	if e != nil {
		return nil, e
	}
	r, e := l.Repo.Get(ctx, Bookmark, k, false)
	if e != nil {
		return nil, e
	}
	if r == nil || r.URI != uri {
		return nil, ErrNotFound
	}
	v := clone(r.Value)
	setTags(v, t)
	if !slices.Equal(t, tags(r.Value)) {
		if e = l.Repo.Apply(ctx, []Write{Update(Bookmark, k, v, r.CID)}); e != nil {
			return nil, e
		}
	}
	r, e = l.Repo.Get(ctx, Bookmark, k, false)
	if e != nil {
		return nil, e
	}
	if r == nil {
		return nil, ErrNotFound
	}
	view, e := l.view(ctx, *r)
	return &view, e
}
func (l Library) SetState(ctx context.Context, uri, state string) error {
	if state != "unread" && state != "archived" {
		return invalidRequest("Invalid saved state")
	}
	k, e := l.key(uri, Bookmark)
	if e != nil {
		return e
	}
	r, e := l.Repo.Get(ctx, Bookmark, k, false)
	if e != nil {
		return e
	}
	if r == nil {
		return ErrNotFound
	}
	m, e := l.Repo.Get(ctx, Metadata, k, false)
	if e != nil {
		return e
	}
	var w Write
	if m == nil {
		w = Create(Metadata, k, newMetadata(r.URI, text(r.Value, "subject"), state))
	} else {
		if !metadataMatches(m, *r) {
			return ErrInvalidRecord
		}
		v := clone(m.Value)
		v["state"] = state
		w = Update(Metadata, k, v, m.CID)
	}
	return l.Repo.Apply(ctx, []Write{w})
}
func (l Library) RemoveBookmark(ctx context.Context, uri string) error {
	k, e := l.key(uri, Bookmark)
	if e != nil {
		return e
	}
	r, e := l.Repo.Get(ctx, Bookmark, k, false)
	if e != nil {
		return e
	}
	if r == nil {
		return ErrNotFound
	}
	m, e := l.Repo.Get(ctx, Metadata, k, false)
	if e != nil {
		return e
	}
	w := []Write{Delete(Bookmark, k, r.CID)}
	if metadataMatches(m, *r) {
		w = append(w, Delete(Metadata, k, m.CID))
	}
	return l.Repo.Apply(ctx, w)
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}
type TagList struct {
	TagCounts []TagCount `json:"tagCounts"`
	Scanned   int        `json:"scanned"`
	Cursor    string     `json:"cursor,omitempty"`
}

func (l Library) Tags(ctx context.Context, limit int, cursor string) (TagList, error) {
	p, e := l.Repo.List(ctx, Bookmark, clamp(limit, 100), cursor)
	out := TagList{TagCounts: []TagCount{}, Scanned: len(p.Records), Cursor: p.Cursor}
	if e != nil {
		return out, e
	}
	counts := map[string]int{}
	for _, r := range p.Records {
		for _, t := range unique(tags(r.Value)) {
			counts[t]++
		}
	}
	keys := []string{}
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		out.TagCounts = append(out.TagCounts, TagCount{k, counts[k]})
	}
	return out, nil
}

type MutationSummary struct {
	OK      bool   `json:"ok"`
	Scanned int    `json:"scanned"`
	Matched int    `json:"matched"`
	Updated int    `json:"updated"`
	Cursor  string `json:"cursor,omitempty"`
}

// MutateTag uses a second verification pass because mutating repository records can reorder pages.
func (l Library) MutateTag(ctx context.Context, source, target string, limit int, cursor string) (MutationSummary, error) {
	out := MutationSummary{OK: true}
	s, e := NormalizeTag(source)
	if e != nil {
		return out, e
	}
	if target != "" {
		target, e = NormalizeTag(target)
		if e != nil {
			return out, e
		}
		if target == s {
			return out, invalidRequest("The replacement tag must differ from the source tag")
		}
	}
	phase := "m:"
	repoCursor := ""
	if cursor != "" {
		if !strings.HasPrefix(cursor, "m:") && !strings.HasPrefix(cursor, "v:") {
			return out, invalidRequest("Invalid tag mutation cursor")
		}
		phase = cursor[:2]
		repoCursor = cursor[2:]
	}
	p, e := l.Repo.List(ctx, Bookmark, clamp(limit, 25), repoCursor)
	if e != nil {
		return out, e
	}
	out.Scanned = len(p.Records)
	writes := []Write{}
	for _, r := range p.Records {
		if !contains(tags(r.Value), s) {
			continue
		}
		out.Matched++
		next := []string{}
		for _, t := range tags(r.Value) {
			if t == s {
				t = target
			}
			if t != "" {
				next = append(next, t)
			}
		}
		v := clone(r.Value)
		setTags(v, unique(next))
		k, e := l.key(r.URI, Bookmark)
		if e != nil {
			return out, e
		}
		writes = append(writes, Update(Bookmark, k, v, r.CID))
	}
	if len(writes) > 0 {
		if e = l.Repo.Apply(ctx, writes); e != nil {
			return out, e
		}
	}
	out.Updated = len(writes)
	if phase == "m:" {
		out.Cursor = "v:"
		if p.Cursor != "" {
			out.Cursor = "m:" + p.Cursor
		}
	} else if len(writes) > 0 {
		out.Cursor = "v:"
	} else if p.Cursor != "" {
		out.Cursor = "v:" + p.Cursor
	}
	return out, nil
}

type SyncSummary struct {
	OK              bool   `json:"ok"`
	Scanned         int    `json:"scanned"`
	Created         int    `json:"created"`
	Reused          int    `json:"reused"`
	SkippedConflict int    `json:"skippedConflict"`
	Cursor          string `json:"cursor,omitempty"`
}

func (l Library) SyncMetadata(ctx context.Context, limit int, cursor string) (SyncSummary, error) {
	out := SyncSummary{OK: true}
	p, e := l.Repo.List(ctx, Bookmark, clamp(limit, 100), cursor)
	if e != nil {
		return out, e
	}
	out.Scanned = len(p.Records)
	out.Cursor = p.Cursor
	metadata, e := l.all(ctx, Metadata)
	if e != nil {
		return out, e
	}
	byKey := map[string]*Record{}
	for i := range metadata {
		k, e := l.key(metadata[i].URI, Metadata)
		if e == nil {
			byKey[k] = &metadata[i]
		}
	}
	w := []Write{}
	for _, r := range p.Records {
		k, e := l.key(r.URI, Bookmark)
		if e != nil {
			return out, e
		}
		if m := byKey[k]; m != nil {
			if metadataMatches(m, r) {
				out.Reused++
			} else {
				out.SkippedConflict++
			}
		} else {
			w = append(w, Create(Metadata, k, newMetadata(r.URI, text(r.Value, "subject"), "unread")))
		}
	}
	if len(w) > 0 {
		if e = l.Repo.Apply(ctx, w); e != nil {
			return out, e
		}
		out.Created = len(w)
	}
	return out, nil
}
