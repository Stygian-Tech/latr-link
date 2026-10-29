package developer

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The caller must supply an isolated test database; never read production DATABASE_URL.
func TestPostgresExistingMigrationCompatibility(t *testing.T) {
	raw := os.Getenv("LATR_GATEWAY_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("LATR_GATEWAY_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("latr_go_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	pcfg, err := pgxpool.ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	pcfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	migration, err := os.ReadFile("../../migrations/001_developer_console.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	store, err := New(ctx, config.Config{AppEnv: "local", DatabaseURL: raw, OfficialClientCredentials: map[string]string{"official": "env-secret"}}, pool)
	if err != nil {
		t.Fatal(err)
	}
	client, err := store.CreateClient(ctx, "did:plc:alice", "app", nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if client.ClientID != "app" || client.DailyRequestLimit != 10000 {
		t.Fatalf("wrong client: %+v", client)
	}
	if _, err = store.CreateClient(ctx, "did:plc:alice", "app", nil, false); err == nil || err.(*Error).Code != "client_exists" {
		t.Fatalf("wrong duplicate error: %v", err)
	}
	key, secret, err := store.CreateAPIKey(ctx, "did:plc:alice", "app", nil)
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{"X-Latr-Client-Id": []string{"app"}, "X-Latr-Api-Key": []string{secret}}
	if id, err := store.ResolveClientID(ctx, headers, true); err != nil || id != "app" {
		t.Fatalf("credential rejected: %s %v", id, err)
	}
	if err = store.RecordUsage(ctx, "app", "saves"); err != nil {
		t.Fatal(err)
	}
	if err = store.RecordUsage(ctx, "official", "saves"); err != nil {
		t.Fatal("env credentials should not require database rows:", err)
	}
	usage, err := store.UsageSummaries(ctx, "did:plc:alice")
	if err != nil || len(usage) != 1 || usage[0].Buckets[0].RequestCount != 1 {
		t.Fatalf("wrong usage: %+v %v", usage, err)
	}
	if _, err = pool.Exec(ctx, "UPDATE developer_clients SET daily_request_limit=1 WHERE client_id='app'"); err != nil {
		t.Fatal(err)
	}
	if err = store.AssertWithinDailyLimit(ctx, "app"); err == nil || err.(*Error).Code != "usage_limit_exceeded" {
		t.Fatalf("quota not enforced: %v", err)
	}
	if _, err = store.ListAPIKeys(ctx, "did:plc:other", "app"); err == nil {
		t.Fatal("account ownership bypass")
	}
	if err = store.RevokeAPIKey(ctx, "did:plc:alice", "app", key.KeyID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ResolveClientID(ctx, headers, true); err == nil {
		t.Fatal("revoked key accepted")
	}
	keys, err := store.ListAPIKeys(ctx, "did:plc:alice", "app")
	if err != nil || len(keys) != 1 || keys[0].RevokedAt == nil || strings.Contains(keys[0].KeyHash, secret) {
		t.Fatalf("wrong revoked key: %+v %v", keys, err)
	}
	if err = store.DeleteClient(ctx, "did:plc:alice", "app"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM developer_api_keys").Scan(&count); err != nil || count != 0 {
		t.Fatalf("delete did not cascade: %d %v", count, err)
	}
}
