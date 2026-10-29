# L@tr Gateway

The active server is Go (`cmd/latr-gateway`). It serves the existing REST and XRPC APIs and writes bookmarks through the viewer’s PDS using client-provided OAuth/DPoP authorization. The Apple application and separate Swift package repositories remain Swift.

```sh
# From the monorepo root
bun install --frozen-lockfile
bash scripts/ci-gateway.sh

# Run locally after exporting needed variables from .env.example
cd services/latr-gateway
go run ./cmd/latr-gateway
```

The Docker image builds only Go source and runs as `nobody`. Railway still applies the unchanged SQL migrations before startup and checks `/health`. Configuration names, JSON developer-store field names, credential hashes, Postgres tables, preview expiry, and upstream proof forwarding remain compatible. Canonical bookmark saves acknowledge the PDS write immediately; missing preview cache data is filled by a bounded two-worker queue. Lists and lookups return cached previews and can enqueue missing metadata. Queue overflow does not fail a save; a subsequent read can request enrichment again. An unreadable/corrupt local JSON credential store now fails startup instead of discarding credentials.

## Package Boundaries

- `internal/latr`: community bookmarks, metadata sidecars, tags, CAS/atomic writes, legacy records and migrations, URL normalization and record keys.
- `internal/pds`: DID discovery, bounded authenticated repository requests, one-use proof pool, PDS session attestation.
- `internal/auth`: gateway DPoP verification, replay rejection, ES256/ES256K token signatures, PDS-authority token mode.
- `internal/developer`: ownership, key hashing/revocation, quotas and usage, JSON/Postgres persistence.
- `internal/preview`: public fetch guards, HTML/provider parsing, subject discovery and previews.
- `internal/server`: HTTP adapters, OAuth metadata, compatibility headers, cache and error policy.

## Migration Evidence

The parity reference is gateway Swift source plus LatrKit revision `f0e2ce680b07fa41d28d7b1cfeac01a25d5df2c6`. `Sources/`, `Tests/`, `Package.swift`, and `Package.resolved` are retained temporarily as migration oracles; they are not built into the Go server or Docker image. Go preview tests reuse the existing provider JSON fixtures, and record-key tests read the canonical fixture supplied by the installed `latr-packages` dependency.

Go coverage includes route/verb/error matrices, strict XRPC inputs, signatures and replay, upstream proof consumption, canonical keys, tag graphemes, atomic CAS writes, migration retention/conflict cases, local JSON persistence, provider golden fixtures, and isolated Postgres integration. Run the database tests against a disposable database with `LATR_GATEWAY_TEST_DATABASE_URL`; the tests create and remove their own schema.

Local checks do not establish hosted deployment or authenticated PDS acceptance. Before rollout, exercise official and developer clients against a test deployment, including OAuth restoration, real tagged saves, state/tag changes, migration/resume, quota accounting, and Chrome/Firefox extension entry points. No deployment, store submission, or production promotion is part of this source migration.
