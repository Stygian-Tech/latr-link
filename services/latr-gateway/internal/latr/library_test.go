package latr

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

type memoryRepo struct {
	records  map[string]Record
	writes   [][]Write
	conflict bool
}

func (m *memoryRepo) DID() string { return "did:plc:alice" }
func (m *memoryRepo) List(_ context.Context, col string, limit int, cursor string) (Page, error) {
	p := Page{Records: []Record{}}
	for _, r := range m.records {
		_, c, _, _ := ParseURI(r.URI)
		if c == col {
			p.Records = append(p.Records, r)
		}
	}
	return p, nil
}
func (m *memoryRepo) Get(_ context.Context, col, key string, _ bool) (*Record, error) {
	r, ok := m.records[col+"/"+key]
	if !ok {
		return nil, nil
	}
	return &r, nil
}
func (m *memoryRepo) Apply(_ context.Context, w []Write) error {
	m.writes = append(m.writes, w)
	if m.conflict {
		return ErrConflict
	}
	for _, w := range w {
		id := w.Collection + "/" + w.Key
		switch w.Type {
		case "com.atproto.repo.applyWrites#delete":
			delete(m.records, id)
		default:
			m.records[id] = Record{URI: "at://" + m.DID() + "/" + id, CID: "new-cid", Value: w.Value}
		}
	}
	return nil
}
func repo() *memoryRepo { return &memoryRepo{records: map[string]Record{}} }
func put(m *memoryRepo, col, key string, v map[string]any) {
	m.records[col+"/"+key] = Record{URI: "at://" + m.DID() + "/" + col + "/" + key, CID: "original-cid", Value: v}
}
func TestGoldenKeys(t *testing.T) {
	b, e := os.ReadFile("../../../../node_modules/latr-packages/packages/record-keys/fixtures/stygian-golden-vectors.v1.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Vectors struct {
			Key struct {
				Normalized string `json:"normalizedUrl"`
				Canonical  string `json:"canonical"`
			} `json:"latrExternalRkey"`
			Fingerprint struct {
				Normalized string `json:"normalizedUrl"`
				Hex        string `json:"sha256Hex"`
			} `json:"latrFingerprint"`
		}
	}
	if e = json.Unmarshal(b, &fixture); e != nil {
		t.Fatal(e)
	}
	if RecordKey(fixture.Vectors.Key.Normalized) != fixture.Vectors.Key.Canonical {
		t.Fatal("key contract mismatch")
	}
	if Fingerprint(fixture.Vectors.Fingerprint.Normalized) != fixture.Vectors.Fingerprint.Hex {
		t.Fatal("fingerprint contract mismatch")
	}
}
func TestNormalizeAndGraphemes(t *testing.T) {
	u, e := NormalizeURL(" HTTPS://Example.COM/article///?z=2&utm_custom=bad&a=hello%20world&z=1#fragment ")
	if e != nil || u != "https://example.com/article?a=hello%20world&z=1&z=2" {
		t.Fatalf("%q %v", u, e)
	}
	if _, e = NormalizeTag(strings.Repeat("👨‍👩‍👧‍👦", 25)); e != nil {
		t.Fatal(e)
	}
	if _, e = NormalizeTag(strings.Repeat("👨‍👩‍👧‍👦", 26)); e == nil {
		t.Fatal("must enforce UTF8 limit")
	}
	if _, e = NormalizeTag(strings.Repeat("e\u0301", 64)); e != nil {
		t.Fatal("must count graphemes", e)
	}
}
func TestSaveAtomicAndPreservesUnknownFields(t *testing.T) {
	ctx := context.Background()
	m := repo()
	l := Library{m}
	v, e := l.SaveBookmark(ctx, "https://example.com/a", []string{" work ", "work"})
	if e != nil {
		t.Fatal(e)
	}
	if len(m.writes) != 1 || len(m.writes[0]) != 2 {
		t.Fatal("bookmark and metadata must be atomic")
	}
	_, _, key, _ := ParseURI(v.URI)
	r := m.records[Bookmark+"/"+key]
	r.Value["futureField"] = map[string]any{"retained": true}
	m.records[Bookmark+"/"+key] = r
	if _, e = l.SaveBookmark(ctx, "https://example.com/a", []string{"new"}); e != nil {
		t.Fatal(e)
	}
	last := m.writes[len(m.writes)-1][0]
	if last.SwapRecord != "new-cid" || last.Value["futureField"] == nil {
		t.Fatal("must preserve fields and use CID")
	}
	if got := tags(last.Value); strings.Join(got, ",") != "work,new" {
		t.Fatal(got)
	}
}
func TestMetadataBindingAndOwnership(t *testing.T) {
	ctx := context.Background()
	m := repo()
	put(m, Bookmark, "one", map[string]any{"subject": "https://example.com", "createdAt": "2020"})
	put(m, Metadata, "one", newMetadata("at://did:plc:other/"+Bookmark+"/one", "https://example.com", "archived"))
	l := Library{m}
	v, e := l.Bookmark(ctx, "https://example.com")
	if e != nil || v.MetadataRecord != nil {
		t.Fatal("mismatched metadata attached")
	}
	if e = l.SetState(ctx, v.URI, "unread"); !errors.Is(e, ErrInvalidRecord) {
		t.Fatal(e)
	}
	if e = l.RemoveBookmark(ctx, "at://did:plc:other/"+Bookmark+"/one"); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross repo mutation allowed")
	}
	if len(m.writes) != 0 {
		t.Fatal("invalid mutations reached repo")
	}
}
func TestTagVerificationAndConflict(t *testing.T) {
	ctx := context.Background()
	m := repo()
	put(m, Bookmark, "one", map[string]any{"subject": "https://example.com", "tags": []string{"old", "target"}, "future": true})
	l := Library{m}
	s, e := l.MutateTag(ctx, "old", "target", 25, "")
	if e != nil || s.Updated != 1 || s.Cursor != "v:" {
		t.Fatalf("%+v %v", s, e)
	}
	if m.writes[0][0].SwapRecord != "original-cid" || !m.writes[0][0].Value["future"].(bool) {
		t.Fatal("unsafe update")
	}
	s, e = l.MutateTag(ctx, "old", "target", 25, s.Cursor)
	if e != nil || s.Cursor != "" {
		t.Fatalf("%+v %v", s, e)
	}
	m.conflict = true
	if _, e = l.SetTags(ctx, "at://"+m.DID()+"/"+Bookmark+"/one", []string{"next"}); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
}
func TestMigrationPreservesDataAndSkipsUnknown(t *testing.T) {
	ctx := context.Background()
	m := repo()
	wrapper := "at://" + m.DID() + "/" + External + "/external"
	put(m, External, "external", map[string]any{"url": "https://example.com", "normalizedUrl": "https://example.com"})
	put(m, SavedItem, "a", map[string]any{"subjectUri": wrapper, "savedAt": "2020", "state": "archived", "note": "note", "tags": []string{"work"}})
	put(m, SavedItem, "b", map[string]any{"subjectUri": wrapper, "savedAt": "2021", "state": "unread", "note": "note"})
	l := Library{m}
	s, e := l.MigrateBookmarks(ctx, 25, "")
	if e != nil || s.Created != 1 || s.Retired != 3 || s.Duplicates != 1 {
		t.Fatalf("%+v %v", s, e)
	}
	if len(m.writes) != 1 || len(m.writes[0]) != 5 {
		t.Fatal("migration must be atomic")
	}
	v, e := l.Bookmark(ctx, "https://example.com")
	if e != nil || text(v.MetadataRecord.Value, "note") != "note" || text(v.MetadataRecord.Value, "state") != "unread" {
		t.Fatalf("%+v %v", v, e)
	}
	put(m, SavedItem, "unknown", map[string]any{"subjectUri": "at://did:plc:a/app.bsky.feed.post/1", "futureField": "keep"})
	s, e = l.MigrateBookmarks(ctx, 25, "")
	if e != nil || s.SkippedConflict != 1 {
		t.Fatalf("%+v %v", s, e)
	}
	if _, ok := m.records[SavedItem+"/unknown"]; !ok {
		t.Fatal("unknown fields deleted")
	}
}
func TestLegacyPreviewContract(t *testing.T) {
	m := repo()
	l := Library{m}
	uri, e := l.SaveLegacy(context.Background(), "https://example.com?a=1", "", map[string]any{"title": "Article", "description": "Excerpt", "siteName": "Publisher", "author": "Writer", "image": "https://example.com/image"})
	if e != nil {
		t.Fatal(e)
	}
	_, _, key, _ := ParseURI(uri)
	r := m.records[SavedItem+"/"+key]
	if text(r.Value, "previewTitle") != "Article" || text(r.Value, "previewExcerpt") != "Excerpt" || text(r.Value, "previewSite") != "Publisher" || text(r.Value, "previewAuthor") != "Writer" {
		t.Fatal(r.Value)
	}
	if _, ok := r.Value["title"]; ok {
		t.Fatal("noncanonical field")
	}
	external := m.records[External+"/"+RecordKey("https://example.com?a=1")]
	if text(external.Value, "excerpt") != "Excerpt" || text(external.Value, "site") != "Publisher" || text(external.Value, "author") != "Writer" {
		t.Fatal(external.Value)
	}
}
func TestMigrationPreviewFieldsAndNoteConflict(t *testing.T) {
	m := repo()
	l := Library{m}
	put(m, SavedItem, "a", map[string]any{"subjectUri": "https://example.com", "savedAt": "2020", "previewTitle": "Article", "previewExcerpt": "Excerpt", "previewAuthor": "Writer"})
	s, e := l.MigrateBookmarks(context.Background(), 25, "")
	if e != nil || s.Created != 1 {
		t.Fatalf("%+v %v", s, e)
	}
	m = repo()
	l = Library{m}
	put(m, SavedItem, "a", map[string]any{"subjectUri": "https://example.com", "savedAt": "2020", "note": "one"})
	put(m, SavedItem, "b", map[string]any{"subjectUri": "https://example.com", "savedAt": "2020", "note": "two"})
	s, e = l.MigrateBookmarks(context.Background(), 25, "")
	if e != nil || s.SkippedConflict != 2 || len(m.writes) > 0 {
		t.Fatalf("%+v %v", s, e)
	}
}
func TestMigrationConflictLeavesLegacyRecords(t *testing.T) {
	m := repo()
	put(m, SavedItem, "a", map[string]any{"subjectUri": "https://example.com", "savedAt": "2020"})
	m.conflict = true
	s, e := (Library{m}).MigrateBookmarks(context.Background(), 25, "")
	if e != nil || s.Created != 0 || s.Retired != 0 || s.SkippedConflict != 1 {
		t.Fatalf("%+v %v", s, e)
	}
	if len(m.records) != 1 {
		t.Fatal("legacy data lost")
	}
}

// These vectors exercise Foundation URLComponents behavior that differs from
// net/url.Values: '+' is literal and a query item need not contain '='.
func TestSwiftNormalizationVectors(t *testing.T) {
	vectors := map[string]string{"HTTP://Example.COM/foo/": "http://example.com/foo", "https://a.com?b=hello%20world&a=https%3A%2F%2Fx.com%2Fa&empty&plus=%2B": "https://a.com?a=https://x.com/a&b=hello%20world&empty&plus=+", "https://a.com/%7euser/%2F?q=%7e": "https://a.com/~user?q=~", "https://a.com/?q=a+b&UTM_foo=x&ref=x": "https://a.com/?q=a+b", "https://a.com/a/?z=2&z=1#x": "https://a.com/a?z=1&z=2"}
	for raw, want := range vectors {
		got, e := NormalizeURL(raw)
		if e != nil || got != want {
			t.Fatalf("%s: got %s, want %s (%v)", raw, got, want, e)
		}
	}
}

func TestMigrationPreservesFutureSavedTimestamp(t *testing.T) {
	m := repo()
	put(m, SavedItem, "future", map[string]any{"subjectUri": "https://future.example", "savedAt": "2099-01-01T00:00:00Z", "state": "archived"})
	l := Library{m}
	summary, err := l.MigrateBookmarks(context.Background(), 25, "")
	if err != nil || summary.Created != 1 {
		t.Fatalf("%+v %v", summary, err)
	}
	view, err := l.Bookmark(context.Background(), "https://future.example")
	if err != nil || text(view.Value, "createdAt") != "2099-01-01T00:00:00Z" {
		t.Fatalf("future timestamp replaced: %+v %v", view, err)
	}
}
func TestLegacySubjectLinkedURLNormalization(t *testing.T) {
	m := repo()
	l := Library{m}
	uri, err := l.SaveLegacy(context.Background(), "at://did:plc:other/app.bsky.feed.post/one", " HTTPS://Example.COM/article/?utm_source=extension&b=2#a ", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _, key, _ := ParseURI(uri)
	record := m.records[SavedItem+"/"+key]
	if text(record.Value, "linkedWebUrl") != "https://example.com/article?b=2" {
		t.Fatal(record.Value)
	}
}

func TestValidationErrorsHaveClientStatus(t *testing.T) {
	for _, err := range []error{func() error { _, err := NormalizeTags(make([]string, 101)); return err }(), func() error {
		_, err := (Library{repo()}).MutateTag(context.Background(), "tag", "new", 25, "bad")
		return err
	}()} {
		var invalid *InvalidRequestError
		if !errors.As(err, &invalid) || invalid.HTTPStatus() != 400 || invalid.ErrorCode() != "invalid_request" {
			t.Fatalf("wrong validation error: %v", err)
		}
	}
}
