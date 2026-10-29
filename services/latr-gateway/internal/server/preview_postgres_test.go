package server

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/preview"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Exercise real PostgreSQL expiration and ON CONFLICT semantics in a temporary
// local cluster, never an existing database or account. CI without PostgreSQL
// binaries still runs the deterministic snapshot and route tests.
func TestPostgresPreviewSnapshotRetention(t *testing.T) {
	initdb, err := exec.LookPath("initdb")
	if err != nil {
		t.Skip("initdb is not installed")
	}
	pgctl, err := exec.LookPath("pg_ctl")
	if err != nil {
		t.Skip("pg_ctl is not installed")
	}
	dir, err := os.MkdirTemp("", "latrpg-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	data := filepath.Join(dir, "data")
	socket := filepath.Join(dir, "socket")
	if err = os.Mkdir(socket, 0700); err != nil {
		t.Fatal(err)
	}
	run := func(binary string, args ...string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, binary, args...).CombinedOutput(); err != nil {
			t.Fatalf("temporary PostgreSQL command failed: %v\n%s", err, output)
		}
	}
	run(initdb, "-D", data, "-A", "trust", "-U", "latr_test", "--no-locale", "--encoding=UTF8")
	run(pgctl, "-D", data, "-l", filepath.Join(dir, "postgres.log"), "-w", "start", "-o", "-F -h '' -k "+socket)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if output, err := exec.CommandContext(ctx, pgctl, "-D", data, "-m", "immediate", "-w", "stop").CombinedOutput(); err != nil {
			t.Errorf("temporary PostgreSQL shutdown failed: %v %s", err, output)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, "host="+socket+" user=latr_test dbname=postgres sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migration, err := os.ReadFile("../../migrations/002_bookmark_previews.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	store := postgresPreviewSnapshots{pool: pool}
	subject := "https://example.com/article"
	original := preview.Fields{Title: "Saved title", Description: "Saved description", Image: "https://example.com/photo.jpg", SiteName: "Publisher", Author: "Writer"}
	if err = store.Write(ctx, subject, original); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE bookmark_previews SET expires_at=NOW()-INTERVAL '30 days' WHERE subject_hash=$1`, latr.Fingerprint(subject)); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Read(ctx, subject)
	if err != nil || snapshot == nil || snapshot.Fields != original || time.Now().Before(snapshot.FreshUntil) {
		t.Fatalf("expired SQL snapshot hidden: %+v %v", snapshot, err)
	}
	many, err := store.ReadMany(ctx, []string{subject, "https://example.com/missing"})
	if err != nil || len(many) != 1 || many[subject].Fields != original {
		t.Fatalf("expired batch SQL snapshot hidden: %+v %v", many, err)
	}
	if err = store.Write(ctx, subject, preview.Fields{Title: "Updated title", Description: " \t\n", Image: "", SiteName: "\n", Author: " "}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = store.Read(ctx, subject)
	want := original
	want.Title = "Updated title"
	if err != nil || snapshot == nil || snapshot.Fields != want || !time.Now().Before(snapshot.FreshUntil) {
		t.Fatalf("SQL partial merge erased fields: %+v %v", snapshot, err)
	}
	// A real database restart must not remove an expired migrated snapshot.
	run(pgctl, "-D", data, "-l", filepath.Join(dir, "postgres.log"), "-m", "fast", "-w", "restart", "-o", "-F -h '' -k "+socket)
	pool.Reset()
	snapshot, err = store.Read(ctx, subject)
	if err != nil || snapshot == nil || snapshot.Fields != want {
		t.Fatalf("snapshot lost after PostgreSQL restart: %+v %v", snapshot, err)
	}
}
