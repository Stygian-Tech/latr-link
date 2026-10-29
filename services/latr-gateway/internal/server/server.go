package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/auth"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/developer"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/pds"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Authenticator interface {
	Authenticate(*http.Request, bool, string) (auth.Context, error)
}
type Server struct {
	Config        config.Config
	Auth          Authenticator
	Store         *developer.Store
	Preview       *preview.Resolver
	Pool          *pgxpool.Pool
	HTTP          *http.Client
	Repository    func(auth.Context) Repository
	mu            sync.RWMutex
	previews      map[string]previewSnapshot
	snapshotStore previewSnapshotStore
	previewOnce   sync.Once
	previewJobs   chan string
	previewCancel context.CancelFunc
	previewWG     sync.WaitGroup
	queued        map[string]bool
}
type Repository interface {
	latr.Repository
	AttestOAuthSession(context.Context) error
}

func New(cfg config.Config, store *developer.Store, pool *pgxpool.Pool, client *http.Client) *Server {
	if client == nil {
		client = &http.Client{}
	}
	s := &Server{Config: cfg, Store: store, Pool: pool, HTTP: client, previews: map[string]previewSnapshot{}, previewJobs: make(chan string, 64), queued: map[string]bool{}}
	if pool != nil {
		s.snapshotStore = postgresPreviewSnapshots{pool: pool}
	}
	s.Auth = auth.New(cfg, store, client)
	s.Preview = preview.New(nil, cfg.PLCURL, cfg.AppViewBaseURLs, cfg.IdentityBaseURL)
	s.Repository = func(a auth.Context) Repository {
		return pds.NewClient(pds.Auth{DID: a.DID, Authorization: a.AuthorizationHeader, DPoPProof: a.DPoPProof, UpstreamDPoPProof: a.UpstreamDPoPProof, SignatureVerified: a.AccessTokenSignatureVerified}, cfg.PLCURL, client)
	}
	return s
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, DPoP, X-ATProto-Upstream-DPoP, X-Latr-Forwarded-Authorization, X-Latr-Forwarded-DPoP, X-Latr-Official-Client, X-Latr-Client-Id, X-Latr-API-Key")
	w.Header().Set("Vary", "Origin")
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	if r.URL.Path == "/health" && r.Method == "GET" {
		jsonResponse(w, 200, map[string]string{"status": "ok", "service": "latr-gateway"})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/oauth/") {
		s.metadata(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/xrpc/") {
		s.xrpc(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/latr/") {
		s.rest(w, r)
		return
	}
	respondError(w, problem(404, "not_found", "Not found"), false)
}
func (s *Server) protected(r *http.Request, developerRoute bool, upstream string) (auth.Context, Repository, error) {
	a, e := s.Auth.Authenticate(r, !developerRoute, upstream)
	if e != nil {
		return a, nil, e
	}
	repo := s.Repository(a)
	if !a.AccessTokenSignatureVerified && (developerRoute || strings.Contains(r.URL.Path, "og-preview") || strings.Contains(r.URL.Path, "discover/at-uri") || strings.Contains(r.URL.Path, "preview.getOpenGraph") || strings.Contains(r.URL.Path, "discovery.resolveUrl")) {
		if e = repo.AttestOAuthSession(r.Context()); e != nil {
			return a, nil, e
		}
	}
	if !developerRoute && a.ClientID != "" {
		e = s.Store.AssertWithinDailyLimit(r.Context(), a.ClientID)
	}
	return a, repo, e
}
func fieldsMap(f *preview.Fields) map[string]any {
	if f == nil {
		return nil
	}
	b, _ := json.Marshal(f)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}

// Preview freshness controls refresh scheduling, never snapshot visibility.
// A successful save never waits for public
// metadata providers after its atomic PDS write has been acknowledged.
func (s *Server) enrichView(ctx context.Context, v *latr.View) { _ = s.enrichViewChecked(ctx, v) }
func (s *Server) queuePreview(subject string) {
	if !strings.HasPrefix(subject, "http://") && !strings.HasPrefix(subject, "https://") {
		return
	}
	s.previewOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		s.previewCancel = cancel
		for range 2 {
			s.previewWG.Go(func() {
				for {
					select {
					case <-ctx.Done():
						return
					case subject := <-s.previewJobs:
						job, cancel := context.WithTimeout(ctx, 35*time.Second)
						f := s.Preview.Resolve(job, subject)
						if f != nil && job.Err() == nil {
							_ = s.cache(job, subject, *f)
						}
						cancel()
						s.mu.Lock()
						delete(s.queued, subject)
						s.mu.Unlock()
					}
				}
			})
		}
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.queued[subject] {
		return
	}
	select {
	case s.previewJobs <- subject:
		s.queued[subject] = true
	default:
	}
}

// Close cancels service-owned enrichment and waits for in-flight public fetches.
// Call it after the HTTP server has stopped accepting requests.
func (s *Server) Close() {
	if s.previewCancel != nil {
		s.previewCancel()
		s.previewWG.Wait()
	}
}

func (s *Server) authProbe(ctx context.Context, a auth.Context, repo Repository) (any, error) {
	p, e := repo.List(ctx, latr.Bookmark, 1, "")
	if e != nil {
		return nil, e
	}
	out := map[string]any{"ok": true, "did": a.DID, "pdsWriteThrough": true, "sampleCount": len(p.Records), "upstreamDpop": a.UpstreamDPoPProof != ""}
	if a.ClientID != "" {
		out["clientId"] = a.ClientID
	}
	return out, nil
}
