package server

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSavePreviewDoesNotWaitForProviders(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		once.Do(func() { close(started) })
		select {
		case <-release:
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`<head><meta property="og:title" content="An actual article"><meta property="og:image" content="https://example.com/photo.jpg"></head>`)), Header: http.Header{}, Request: r}, nil
	})}
	s := New(config.Config{}, nil, nil, nil)
	s.Preview = preview.New(client, "", nil, "")
	t.Cleanup(s.Close)
	v := latr.View{Value: map[string]any{"subject": "https://example.com/article"}}
	done := make(chan struct{})
	go func() { s.enrichView(context.Background(), &v); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("save waited for provider before returning")
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("preview job did not start")
	}
	if v.Preview != nil {
		t.Fatal("unexpected uncached preview")
	}
	close(release)
	deadline := time.After(2 * time.Second)
	for {
		if f := s.cached(context.Background(), "https://example.com/article"); f != nil {
			if f.Title != "An actual article" {
				t.Fatal(f)
			}
			break
		}
		select {
		case <-deadline:
			t.Fatal("preview cache was not populated")
		case <-time.After(time.Millisecond):
		}
	}
	followup := latr.View{Value: v.Value}
	s.enrichView(context.Background(), &followup)
	if followup.Preview["title"] != "An actual article" {
		t.Fatal("subsequent read did not return cached enrichment")
	}
}
func TestPreviewWorkersCancelAndDeduplicate(t *testing.T) {
	entered := make(chan struct{})
	var once sync.Once
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		once.Do(func() { close(entered) })
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}
	s := New(config.Config{}, nil, nil, nil)
	s.Preview = preview.New(client, "", nil, "")
	for range 10 {
		s.queuePreview("https://example.com/article")
	}
	<-entered
	s.mu.RLock()
	count := len(s.queued)
	s.mu.RUnlock()
	if count != 1 {
		t.Fatalf("duplicate pending jobs: %d", count)
	}
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("preview worker ignored shutdown")
	}
}
