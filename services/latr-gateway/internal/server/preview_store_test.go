package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
)

type testSnapshotStore struct {
	mu          sync.Mutex
	values      map[string]previewSnapshot
	writeError  error
	readError   error
	failOnWrite int
	writes      int
}

func (s *testSnapshotStore) Read(_ context.Context, subject string) (*previewSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readError != nil {
		return nil, s.readError
	}
	v, ok := s.values[subject]
	if !ok {
		return nil, nil
	}
	return &v, nil
}
func (s *testSnapshotStore) Write(_ context.Context, subject string, f preview.Fields) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.writes++
	if s.writeError != nil && (s.failOnWrite == 0 || s.writes >= s.failOnWrite) {
		return s.writeError
	}
	old := s.values[subject]
	s.values[subject] = previewSnapshot{Fields: mergePreviewSnapshot(f, old.Fields), FreshUntil: time.Now().Add(7 * 24 * time.Hour)}
	return nil
}
func TestExpiredSnapshotVisibleWhileRefreshIsBlocked(t *testing.T) {
	s, _, repo := fixture(t)
	subject := "https://example.com/article"
	old := preview.Fields{Title: "Saved article", Description: "Saved description", Image: "https://example.com/original.jpg", SiteName: "Publisher", Author: "Writer"}
	s.snapshotStore = &testSnapshotStore{values: map[string]previewSnapshot{subject: {Fields: old, FreshUntil: time.Now().Add(-24 * time.Hour)}}}
	entered := make(chan struct{})
	var once sync.Once
	s.Preview = preview.New(&http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
		once.Do(func() { close(entered) })
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}, "", nil, "")
	uri := "at://" + repo.DID() + "/" + latr.Bookmark + "/one"
	repo.records[latr.Bookmark+"/one"] = latr.Record{URI: uri, CID: "cid", Value: map[string]any{"subject": subject, "createdAt": "2020"}}
	if f, fresh := s.cachedSnapshot(context.Background(), subject); f == nil || fresh || *f != old {
		t.Fatalf("expired snapshot lost: %+v fresh=%v", f, fresh)
	}
	done := make(chan struct{})
	var listBody string
	go func() {
		w := request(s, "GET", "/xrpc/link.latr.bookmarks.listBookmarks", "")
		listBody = w.Body.String()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("list waited for stale snapshot refresh")
	}
	if !strings.Contains(listBody, "Saved article") || !strings.Contains(listBody, "original.jpg") {
		t.Fatal(listBody)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("stale snapshot did not schedule a refresh")
	}
	w := request(s, "GET", "/xrpc/link.latr.bookmarks.getBookmark?subject="+subject, "")
	expect(t, w, 200, "")
	if !strings.Contains(w.Body.String(), "Saved article") || !strings.Contains(w.Body.String(), "original.jpg") {
		t.Fatal(w.Body.String())
	}
	s.Close()
	if got := s.cached(context.Background(), subject); got == nil || *got != old {
		t.Fatalf("failed/cancelled refresh erased snapshot: %+v", got)
	}
}
func TestPartialRefreshPreservesEveryExistingField(t *testing.T) {
	s, _, _ := fixture(t)
	ctx := context.Background()
	subject := "https://example.com"
	old := preview.Fields{Title: "Original title", Description: "Original description", Image: "https://example.com/photo.jpg", SiteName: "Publisher", Author: "Author"}
	if err := s.cache(ctx, subject, old); err != nil {
		t.Fatal(err)
	}
	if err := s.cache(ctx, subject, preview.Fields{Title: "Updated title", Description: " \t", Image: "", SiteName: "\n", Author: " "}); err != nil {
		t.Fatal(err)
	}
	got := s.cached(ctx, subject)
	want := old
	want.Title = "Updated title"
	if got == nil || *got != want {
		t.Fatalf("partial refresh erased fields: %+v", got)
	}
	s.mu.RLock()
	before := s.previews[subject].FreshUntil
	s.mu.RUnlock()
	if err := s.cache(ctx, subject, preview.Fields{Title: " \n", Description: "\t"}); err != nil {
		t.Fatal(err)
	}
	s.mu.RLock()
	after := s.previews[subject].FreshUntil
	s.mu.RUnlock()
	if !before.Equal(after) || *s.cached(ctx, subject) != want {
		t.Fatal("empty provider result replaced snapshot or reset freshness")
	}
}
func legacyPreviewFixture(t *testing.T) (*Server, *testRepository, latr.Library) {
	s, _, repo := fixture(t)
	wrapperURI := "at://" + repo.DID() + "/" + latr.External + "/external"
	repo.records[latr.External+"/external"] = latr.Record{URI: wrapperURI, CID: "wrapper-cid", Value: map[string]any{"$type": latr.External, "url": "https://example.com/article", "normalizedUrl": "https://example.com/article", "fingerprint": "hash", "createdAt": "2020", "title": "Original title", "image": "https://example.com/original.jpg", "site": "Publisher"}}
	repo.records[latr.SavedItem+"/item"] = latr.Record{URI: "at://" + repo.DID() + "/" + latr.SavedItem + "/item", CID: "item-cid", Value: map[string]any{"$type": latr.SavedItem, "subjectUri": wrapperURI, "linkedWebUrl": "https://example.com/article", "savedAt": "2020", "previewTitle": "Item title"}}
	return s, repo, latr.Library{Repo: repo}
}
func TestMigrationRequiresSuccessfulDurablePreviewSnapshot(t *testing.T) {
	for _, failure := range []string{"ephemeral", "write-failure", "second-write-failure"} {
		t.Run(failure, func(t *testing.T) {
			s, repo, l := legacyPreviewFixture(t)
			if failure == "write-failure" || failure == "second-write-failure" {
				s.snapshotStore = &testSnapshotStore{values: map[string]previewSnapshot{}, writeError: errors.New("database unavailable")}
				if failure == "second-write-failure" {
					s.snapshotStore.(*testSnapshotStore).failOnWrite = 2
				}
			}
			_, err := s.migrateBookmarks(context.Background(), l, 25, "")
			var gateway *gatewayError
			if !errors.As(err, &gateway) || gateway.Status != 503 || gateway.Code != "preview_store_unavailable" {
				t.Fatalf("migration did not fail closed: %v", err)
			}
			if len(repo.writes) != 0 || len(repo.records) != 2 {
				t.Fatalf("legacy records retired despite lost snapshot: writes=%v", repo.writes)
			}
		})
	}
}
func TestMigrationMergesSnapshotsBeforeRetiringLegacyRecords(t *testing.T) {
	s, repo, l := legacyPreviewFixture(t)
	store := &testSnapshotStore{values: map[string]previewSnapshot{}}
	s.snapshotStore = store
	raw, err := s.migrateBookmarks(context.Background(), l, 25, "")
	if err != nil {
		t.Fatal(err)
	}
	summary := raw.(latr.MigrationSummary)
	if summary.Created != 1 || summary.Retired != 2 || summary.Cached != 2 {
		t.Fatalf("%+v", summary)
	}
	snapshot, err := store.Read(context.Background(), "https://example.com/article")
	if err != nil || snapshot == nil || snapshot.Fields.Title != "Item title" || snapshot.Fields.Image != "https://example.com/original.jpg" || snapshot.Fields.SiteName != "Publisher" {
		t.Fatalf("migration discarded richer wrapper preview: %+v %v", snapshot, err)
	}
	if len(repo.writes) != 1 {
		t.Fatal("migration must retire sources only after all snapshots are stored")
	}
	store.mu.Lock()
	value := store.values["https://example.com/article"]
	value.FreshUntil = time.Now().Add(-30 * 24 * time.Hour)
	store.values["https://example.com/article"] = value
	store.mu.Unlock()
	restarted, _, _ := fixture(t)
	restarted.snapshotStore = store
	if got, fresh := restarted.cachedSnapshot(context.Background(), "https://example.com/article"); got == nil || fresh || got.Image != "https://example.com/original.jpg" {
		t.Fatalf("persisted migrated snapshot expired away after restart: %+v %v", got, fresh)
	}
}

func TestMigrationSnapshotsUseExactWrapperSubject(t *testing.T) {
	for _, linked := range []string{"", "https://example.com/article"} {
		t.Run(linked, func(t *testing.T) {
			s, repo, l := legacyPreviewFixture(t)
			store := &testSnapshotStore{values: map[string]previewSnapshot{}}
			s.snapshotStore = store
			original := "https://example.com/article?source=original"
			wrapper := repo.records[latr.External+"/external"]
			wrapper.Value["url"] = original
			delete(wrapper.Value, "title")
			delete(wrapper.Value, "image")
			delete(wrapper.Value, "site")
			item := repo.records[latr.SavedItem+"/item"]
			item.Value["linkedWebUrl"] = linked
			if _, err := s.migrateBookmarks(context.Background(), l, 25, ""); err != nil {
				t.Fatal(err)
			}
			snapshot, err := store.Read(context.Background(), original)
			if err != nil || snapshot == nil || snapshot.Fields.Title != "Item title" {
				t.Fatalf("snapshot lost under a different subject: %+v %v", snapshot, err)
			}
		})
	}
}

func TestMigrationKeepsUnrepresentedWrapperMetadata(t *testing.T) {
	for _, field := range []string{"language", "publishedAt"} {
		t.Run(field, func(t *testing.T) {
			s, repo, l := legacyPreviewFixture(t)
			s.snapshotStore = &testSnapshotStore{values: map[string]previewSnapshot{}}
			wrapper := repo.records[latr.External+"/external"]
			wrapper.Value[field] = "preserve this value"
			raw, err := s.migrateBookmarks(context.Background(), l, 25, "")
			if err != nil {
				t.Fatal(err)
			}
			summary := raw.(latr.MigrationSummary)
			if summary.Retired != 0 || summary.SkippedConflict != 1 || len(repo.writes) != 0 {
				t.Fatalf("unrepresented metadata retired: %+v", summary)
			}
		})
	}
}

type testBatchSnapshotStore struct {
	testSnapshotStore
	reads, batchReads int
}

func (s *testBatchSnapshotStore) Read(ctx context.Context, subject string) (*previewSnapshot, error) {
	s.reads++
	return s.testSnapshotStore.Read(ctx, subject)
}
func (s *testBatchSnapshotStore) ReadMany(_ context.Context, subjects []string) (map[string]previewSnapshot, error) {
	s.batchReads++
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]previewSnapshot{}
	for _, subject := range subjects {
		if snapshot, ok := s.values[subject]; ok {
			out[subject] = snapshot
		}
	}
	return out, nil
}
func TestLibraryListBatchesPreviewSnapshots(t *testing.T) {
	s, _, repo := fixture(t)
	store := &testBatchSnapshotStore{testSnapshotStore: testSnapshotStore{values: map[string]previewSnapshot{}}}
	s.snapshotStore = store
	for i := range 50 {
		key := fmt.Sprint(i)
		subject := "at://did:plc:author/app.bsky.feed.post/" + key
		repo.records[latr.Bookmark+"/"+key] = latr.Record{URI: "at://" + repo.DID() + "/" + latr.Bookmark + "/" + key, CID: "cid", Value: map[string]any{"subject": subject, "createdAt": "2020"}}
		store.values[subject] = previewSnapshot{Fields: preview.Fields{Title: "Saved title " + key}, FreshUntil: time.Now().Add(-time.Hour)}
	}
	w := request(s, "GET", "/xrpc/link.latr.bookmarks.listBookmarks", "")
	expect(t, w, 200, "")
	if store.batchReads != 1 || store.reads != 0 {
		t.Fatalf("preview lookup waterfall: batch=%d individual=%d", store.batchReads, store.reads)
	}
	out := decoded(t, w)
	bookmarks, _ := out["bookmarks"].([]any)
	if len(bookmarks) != 50 {
		t.Fatal(len(bookmarks))
	}
	for _, record := range bookmarks {
		value := record.(map[string]any)
		if value["preview"] == nil {
			t.Fatal("batch omitted stale snapshot")
		}
	}
}
func TestPreviewReadFailureDoesNotReturnEmptySuccessfulFeed(t *testing.T) {
	s, _, repo := fixture(t)
	s.snapshotStore = &testSnapshotStore{readError: errors.New("database unavailable")}
	subject := "at://did:plc:author/app.bsky.feed.post/1"
	repo.records[latr.Bookmark+"/one"] = latr.Record{URI: "at://" + repo.DID() + "/" + latr.Bookmark + "/one", CID: "cid", Value: map[string]any{"subject": subject, "createdAt": "2020"}}
	for _, path := range []string{"/xrpc/link.latr.bookmarks.listBookmarks", "/xrpc/link.latr.bookmarks.getBookmark?subject=" + subject} {
		expect(t, request(s, "GET", path, ""), 503, "UpstreamFailure")
	}
	expect(t, request(s, "POST", "/xrpc/link.latr.bookmarks.saveBookmark", `{"subject":"`+subject+`"}`), 200, "")
}
