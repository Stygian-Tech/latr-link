package developer

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(context.Background(), config.Config{AppEnv: "test", OfficialClientCredentials: map[string]string{"official": "env-secret"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return time.Date(2026, 10, 26, 23, 59, 59, 0, time.UTC) }
	return s
}
func TestDeveloperOwnershipKeysAndRevocation(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	c, err := s.CreateClient(ctx, "did:plc:alice", " My-App ", nil, false)
	if err != nil || c.ClientID != "my-app" {
		t.Fatalf("create: %+v %v", c, err)
	}
	if _, err = s.CreateClient(ctx, "did:plc:bob", "my-app", nil, false); err == nil {
		t.Fatal("duplicate accepted")
	}
	if _, _, err = s.CreateAPIKey(ctx, "did:plc:bob", c.ClientID, nil); err == nil {
		t.Fatal("another owner created key")
	}
	key, secret, err := s.CreateAPIKey(ctx, "did:plc:alice", c.ClientID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "lk_") || strings.Contains(key.KeyHash, secret) || key.KeyHash != HashCredential(secret) {
		t.Fatal("bad credential storage")
	}
	h := http.Header{"X-Latr-Client-Id": []string{c.ClientID}, "X-Latr-Api-Key": []string{secret}}
	if id, err := s.ResolveClientID(ctx, h, true); err != nil || id != c.ClientID {
		t.Fatalf("split auth: %s %v", id, err)
	}
	if err = s.RevokeAPIKey(ctx, "did:plc:alice", c.ClientID, key.KeyID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ResolveClientID(ctx, h, true); err == nil {
		t.Fatal("revoked key accepted")
	}
	if err = s.DeleteClient(ctx, "did:plc:bob", c.ClientID); err == nil {
		t.Fatal("another owner deleted client")
	}
	if err = s.DeleteClient(ctx, "did:plc:alice", c.ClientID); err != nil {
		t.Fatal(err)
	}
	if len(s.data.APIKeys) != 1 {
		t.Fatal("client delete did not cascade keys")
	}
}
func TestOfficialAndDeveloperCredentialPolicies(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	for _, h := range []http.Header{{"X-Latr-Official-Client": []string{"env-secret"}}, {"X-Latr-Client-Id": []string{"official"}, "X-Latr-Api-Key": []string{"env-secret"}}} {
		if id, err := s.ResolveClientID(ctx, h, true); err != nil || id != "official" {
			t.Fatalf("official credential rejected: %s %v", id, err)
		}
	}
	if id, err := s.ResolveClientID(ctx, http.Header{}, false); err != nil || id != "" {
		t.Fatal("exempt route requires credentials")
	}
	if _, err := s.ResolveClientID(ctx, http.Header{}, true); err == nil {
		t.Fatal("missing credential accepted")
	}
}
func TestSwiftSnapshotCompatibilityAndDurability(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "developer-store.json")
	fixture := `{"clients":{"app":{"clientID":"app","ownerDID":"did:plc:alice","isOfficial":false,"billingStatus":"preview","dailyRequestLimit":2,"createdAt":"2026-10-26T00:00:00Z"}},"apiKeys":{"old":{"keyID":"old","clientID":"app","keyHash":"` + HashCredential("old-secret") + `","createdAt":"2026-10-26T00:00:00Z"}},"usage":{}}`
	if err := os.WriteFile(path, []byte(fixture), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AppEnv: "local", DeveloperStorePath: path}
	s, err := New(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	s.Now = func() time.Time { return time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC) }
	h := http.Header{"X-Latr-Official-Client": []string{"old-secret"}}
	if id, err := s.ResolveClientID(ctx, h, true); err != nil || id != "app" {
		t.Fatalf("old credential failed: %s %v", id, err)
	}
	if err = s.RecordUsage(ctx, "app", "saves"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := New(ctx, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.data.Usage["app|2026-10-26|saves"] != 1 {
		t.Fatal("usage not durable")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err = json.Unmarshal(data, &raw); err != nil || raw["apiKeys"] == nil {
		t.Fatal("snapshot shape changed")
	}
	if err = s.RecordUsage(ctx, "app", "saves"); err != nil {
		t.Fatal(err)
	}
	if err = s.AssertWithinDailyLimit(ctx, "app"); err == nil {
		t.Fatal("daily quota not enforced")
	}
	s.Now = func() time.Time { return time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC) }
	if err = s.AssertWithinDailyLimit(ctx, "app"); err != nil {
		t.Fatal("quota did not reset at UTC midnight")
	}
}
func TestPersistenceFailureRollsBackMutation(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	s.path = filepath.Join(t.TempDir(), "target")
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateClient(ctx, "did:plc:a", "failed", nil, false); err == nil {
		t.Fatal("persistence failure suppressed")
	}
	if _, exists := s.data.Clients["failed"]; exists {
		t.Fatal("failed persistent mutation retained")
	}
}
func TestConcurrentUsageIsNotLost(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if _, err := s.CreateClient(ctx, "did:plc:a", "app", nil, false); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 25 {
		wg.Go(func() {
			if err := s.RecordUsage(ctx, "app", "saves"); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	summaries, err := s.UsageSummaries(ctx, "did:plc:a")
	if err != nil || len(summaries) != 1 || summaries[0].Buckets[0].RequestCount != 25 {
		t.Fatalf("lost usage: %+v %v", summaries, err)
	}
}
