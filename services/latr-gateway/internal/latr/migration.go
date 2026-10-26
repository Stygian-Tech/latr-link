package latr

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

type MigrationSummary struct {
	OK              bool   `json:"ok"`
	Scanned         int    `json:"scanned"`
	Created         int    `json:"created"`
	Reused          int    `json:"reused"`
	Duplicates      int    `json:"duplicates"`
	SkippedConflict int    `json:"skippedConflict"`
	Cached          int    `json:"cached"`
	Retired         int    `json:"retired"`
	Cursor          string `json:"cursor,omitempty"`
}
type source struct {
	collection string
	record     Record
}

func (l Library) sources(ctx context.Context, cols ...string) ([]source, error) {
	out := []source{}
	for _, col := range cols {
		records, e := l.all(ctx, col)
		if e != nil {
			return nil, e
		}
		for _, r := range records {
			out = append(out, source{col, r})
		}
	}
	return out, nil
}
func hasUnknown(v map[string]any, fields string) bool {
	known := map[string]bool{}
	for _, k := range strings.Fields(fields) {
		known[k] = true
	}
	for k := range v {
		if !known[k] {
			return true
		}
	}
	return false
}
func (l Library) MigrateBookmarks(ctx context.Context, limit int, cursor string) (MigrationSummary, error) {
	out := MigrationSummary{OK: true}
	externals, e := l.sources(ctx, External, LegacyExternal)
	if e != nil {
		return out, e
	}
	byURI := map[string]source{}
	for _, s := range externals {
		byURI[s.record.URI] = s
	}
	items, e := l.sources(ctx, SavedItem, LegacySavedItem)
	if e != nil {
		return out, e
	}
	groups := map[string][]source{}
	for _, s := range items {
		subject := text(s.record.Value, "subjectUri")
		if wrapper, ok := byURI[subject]; ok {
			subject = strings.TrimSpace(text(wrapper.record.Value, "url"))
			if !strings.HasPrefix(subject, "https://") && !strings.HasPrefix(subject, "http://") {
				subject = text(wrapper.record.Value, "normalizedUrl")
			}
		} else if linked := strings.TrimSpace(text(s.record.Value, "linkedWebUrl")); strings.HasPrefix(linked, "https://") || strings.HasPrefix(linked, "http://") {
			subject = linked
		}
		groups[subject] = append(groups[subject], s)
	}
	subjects := []string{}
	for s := range groups {
		if s > strings.TrimSpace(cursor) {
			subjects = append(subjects, s)
		}
	}
	sort.Strings(subjects)
	limit = clamp(limit, 100)
	if len(subjects) > limit {
		out.Cursor = subjects[limit-1]
		subjects = subjects[:limit]
	}
	for _, subject := range subjects {
		entries := groups[subject]
		out.Scanned += len(entries)
		out.Duplicates += len(entries) - 1
		notes := []string{}
		allTags := []string{}
		wrappers := map[string]source{}
		unknown := false
		state := "archived"
		createdAt := ""
		lastOpened := ""
		legacyURIs := []string{}
		for _, s := range entries {
			v := s.record.Value
			legacyURIs = append(legacyURIs, s.record.URI)
			note := strings.TrimSpace(text(v, "note"))
			if note != "" {
				notes = append(notes, note)
			}
			allTags = append(allTags, tags(v)...)
			if text(v, "state") != "archived" {
				state = "unread"
			}
			if t := text(v, "savedAt"); t != "" && (createdAt == "" || t < createdAt) {
				createdAt = t
			}
			if t := text(v, "lastOpenedAt"); t > lastOpened {
				lastOpened = t
			}
			unknown = unknown || hasUnknown(v, "$type subjectUri savedAt state note tags lastOpenedAt linkedWebUrl previewTitle previewExcerpt previewImage previewSite previewAuthor")
			if wrapper, ok := byURI[text(v, "subjectUri")]; ok {
				wrappers[wrapper.record.URI] = wrapper
				// language and publishedAt have no destination in the current
				// bookmark or preview schema. Preserve those source records.
				unknown = unknown || hasUnknown(wrapper.record.Value, "$type url normalizedUrl fingerprint createdAt title excerpt image site author")
			}
		}
		if createdAt == "" {
			createdAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		notes = unique(notes)
		if len(notes) > 1 || unknown {
			out.SkippedConflict += len(entries)
			continue
		}
		existing, e := l.Bookmark(ctx, subject)
		if e != nil {
			return out, e
		}
		key := NewTID()
		uri := "at://" + l.Repo.DID() + "/" + Bookmark + "/" + key
		bookmark := map[string]any{"$type": Bookmark, "subject": subject, "createdAt": createdAt}
		metadata := newMetadata(uri, subject, state)
		var currentMetadata *Record
		if existing != nil {
			key, e = l.key(existing.URI, Bookmark)
			if e != nil {
				return out, e
			}
			uri = existing.URI
			bookmark = clone(existing.Value)
			if t := text(bookmark, "createdAt"); t == "" || createdAt < t {
				bookmark["createdAt"] = createdAt
			}
			allTags = append(allTags, tags(existing.Value)...)
			currentMetadata = existing.MetadataRecord
			if currentMetadata != nil {
				metadata = clone(currentMetadata.Value)
			}
		}
		if len(notes) > 0 {
			current := strings.TrimSpace(text(metadata, "note"))
			if current != "" && current != notes[0] {
				out.SkippedConflict += len(entries)
				continue
			}
			if text(metadata, "note") == "" {
				metadata["note"] = notes[0]
			}
		}
		if text(metadata, "state") == "" {
			metadata["state"] = state
		}
		metadata["bookmarkUri"] = uri
		metadata["subject"] = subject
		if lastOpened > text(metadata, "lastOpenedAt") {
			metadata["lastOpenedAt"] = lastOpened
		}
		if a, ok := metadata["legacyItemUris"].([]any); ok {
			for _, v := range a {
				if s, ok := v.(string); ok {
					legacyURIs = append(legacyURIs, s)
				}
			}
		} else if a, ok := metadata["legacyItemUris"].([]string); ok {
			legacyURIs = append(legacyURIs, a...)
		}
		legacyURIs = unique(legacyURIs)
		sort.Strings(legacyURIs)
		metadata["legacyItemUris"] = legacyURIs
		allTags = unique(allTags)
		sort.Strings(allTags)
		setTags(bookmark, allTags)
		writes := []Write{}
		if existing == nil {
			writes = append(writes, Create(Bookmark, key, bookmark))
		} else {
			writes = append(writes, Update(Bookmark, key, bookmark, existing.CID))
		}
		if currentMetadata == nil {
			writes = append(writes, Create(Metadata, key, metadata))
		} else {
			writes = append(writes, Update(Metadata, key, metadata, currentMetadata.CID))
		}
		for _, s := range entries {
			_, _, k, e := ParseURI(s.record.URI)
			if e != nil {
				return out, e
			}
			writes = append(writes, Delete(s.collection, k, s.record.CID))
		}
		for _, s := range wrappers {
			_, _, k, e := ParseURI(s.record.URI)
			if e != nil {
				return out, e
			}
			writes = append(writes, Delete(s.collection, k, s.record.CID))
		}
		if e = l.Repo.Apply(ctx, writes); e != nil {
			if errors.Is(e, ErrConflict) {
				out.SkippedConflict += len(entries)
				continue
			}
			return out, e
		}
		if existing == nil {
			out.Created++
		} else {
			out.Reused++
		}
		out.Retired += len(entries) + len(wrappers)
	}
	return out, nil
}
