# L@tr gateway

Server-side L@tr API (Swift/Hummingbird) compatible with The Social Wire’s gateway direction. Clients authenticate in two layers:

1. **Client API key** — identifies the registered application (`latr-web`, `social-wire`, …).
2. **User OAuth** — ATProto access token + RFC 9449 DPoP for the signed-in viewer; forwarded to the PDS for `com.atproto.repo.*` mutations.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:8080` (`NEXT_PUBLIC_LATR_GATEWAY_URL`) |
| Fly dev | `https://latr-link-dev-gateway.fly.dev` (after deploy) |

## Auth

### Client API keys

Registered first-party apps send:

| Header | Description |
|--------|-------------|
| `X-Latr-Client-Id` | Registered client name (e.g. `latr-web`, `social-wire`) |
| `X-Latr-API-Key` | Secret issued for that client |

When `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` (default in `APP_ENV=prod`), both headers are required on every `/v1/latr/*` route (except the registration routes below).

Keys come from either:

- **Bootstrap env** — `LATR_GATEWAY_CLIENT_API_KEYS` for operator-provisioned clients
- **Client registration API** — persisted to `LATR_GATEWAY_CLIENT_REGISTRY_PATH`

**L@tr web** — set `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_ID` and `NEXT_PUBLIC_LATR_GATEWAY_API_KEY` when calling a hosted gateway that enforces keys. These ship in the browser bundle; issue a `latr-web`-scoped key with rate limits.

**The Social Wire** — register once via `POST /v1/latr/clients/register`, store the returned `apiKey` in native/server config, then send the headers on gateway requests alongside user OAuth.

Local development (`APP_ENV=local`) skips client API keys by default.

### Registering a client

Registration routes are protected by `LATR_GATEWAY_CLIENT_REGISTRATION_SECRET` (open in `APP_ENV=local` when the secret is unset).

```bash
curl -sS -X POST "$GATEWAY/v1/latr/clients/register" \
  -H "Authorization: Bearer $LATR_GATEWAY_CLIENT_REGISTRATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"clientId":"social-wire","displayName":"The Social Wire"}'
```

Response (`201`):

```json
{
  "clientId": "social-wire",
  "apiKey": "latr_…",
  "displayName": "The Social Wire",
  "createdAt": "2026-05-24T00:00:00Z"
}
```

Store `apiKey` immediately — it is shown once. Only a SHA-256 hash is persisted.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/latr/clients/register` | Registration secret | Create client credentials |
| GET | `/v1/latr/clients` | Registration secret | List registered clients (no secrets) |
| DELETE | `/v1/latr/clients/:clientId` | Registration secret | Revoke a registered client |

`clientId` must match `^[a-z][a-z0-9-]{0,62}$`.

### User OAuth + DPoP

All `/v1/latr/*` save/list routes also require:

- `Authorization: DPoP <access-token-jwt>` (or `Bearer`)
- `DPoP: <dpop-proof-jwt>` bound to the gateway request
- Optional `X-ATProto-Upstream-DPoP: <dpop-proof-jwt>` — PDS-bound proof for write-through (preferred when the client can mint it)

Gateway verifies token structure (`sub` DID, `exp`) and optional OAuth client allowlists:

- `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT=true`
- `OAUTH_GATEWAY_ALLOWED_CLIENT_IDS=https://latr.link/client-metadata.json,https://thesocialwire.app/client-metadata.json`

### Auth probe

`POST /v1/latr/auth/probe` — lists one saved item via PDS to confirm write-through credentials. Response includes `clientId` when client API key auth is active.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Public health check |
| POST | `/v1/latr/clients/register` | Register gateway client credentials |
| GET | `/v1/latr/clients` | List registered clients |
| DELETE | `/v1/latr/clients/:clientId` | Revoke registered client |
| POST | `/v1/latr/auth/probe` | Authenticated PDS connectivity check |
| GET | `/v1/latr/saves` | List `com.latr.saved.item` records |
| POST | `/v1/latr/saves` | Save URL (`{ kind: "url", url }`) or subject (`{ kind: "subject", subjectUri, linkedWebUrl? }`) |
| GET | `/v1/latr/saves/subject?subjectUri=` | Lookup saved item by subject |
| PATCH | `/v1/latr/saves/:itemRkey/state` | Body: `{ state: "unread" \| "archived" }` |
| DELETE | `/v1/latr/saves/:itemRkey` | Unsave (item edge only) |
| GET | `/v1/latr/discover/at-uri?url=` | Standard.site / HTML AT URI discovery |
| GET | `/v1/latr/og-preview?url=` | Server OG fetch (SSRF guarded) |

Record mutations are implemented in the Swift **`LatrKit`** library (`SavedLibrary`) and exposed by the gateway. Open Graph metadata is stored on `com.latr.saved.external` (URL saves) and `com.latr.saved.item` preview fields (native subjects with `linkedWebUrl`).

## Environment variables

Full template: `services/latr-gateway/.env.example`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP listen port |
| `APP_ENV` | No | `local` | `local`, `dev`, `prod`, or `test` — drives default auth policy |
| `PLC_URL` | No | `https://plc.directory` | PLC directory base URL for PDS resolution |
| `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT` | No | `true` when `APP_ENV=prod` | Require JWT `client_id` / `azp` / `aud` in allowlist |
| `OAUTH_GATEWAY_ALLOWED_CLIENT_IDS` | When OAuth policy on | _(empty)_ | Comma/whitespace-separated OAuth client metadata URLs |
| `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` | No | `true` when `APP_ENV=prod` | Require `X-Latr-Client-Id` + `X-Latr-API-Key` |
| `LATR_GATEWAY_CLIENT_API_KEYS` | No | _(empty)_ | Bootstrap `client-id=secret` pairs (comma/semicolon separated) |
| `LATR_GATEWAY_CLIENT_REGISTRY_PATH` | No | `./data/client-registry.json` | JSON file for registered clients |
| `LATR_GATEWAY_CLIENT_REGISTRATION_SECRET` | Dev/prod registration | _(unset)_ | Bearer secret for client registration routes |

**Web client (Vercel / `.env.local`):**

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_LATR_GATEWAY_URL` | Gateway base URL (default `http://127.0.0.1:8080`) |
| `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_ID` | Registered client id (e.g. `latr-web`) when hosted gateway requires keys |
| `NEXT_PUBLIC_LATR_GATEWAY_API_KEY` | Matching API key for the web client |

## Local development

```bash
# Terminal 1 — gateway (Swift/Hummingbird)
cd services/latr-gateway && swift run LatrGateway

# Terminal 2 — register a client (open in APP_ENV=local)
curl -sS -X POST http://127.0.0.1:8080/v1/latr/clients/register \
  -H "Content-Type: application/json" \
  -d '{"clientId":"latr-web","displayName":"L@tr.link web"}'

# Terminal 3 — web (uses NEXT_PUBLIC_LATR_GATEWAY_URL or http://127.0.0.1:8080)
cd apps/web && bun run dev
```

Sign in at `http://127.0.0.1:3000`, then save/list/archive via the library UI.

## Fly deployment (dev)

Deploy from the **monorepo root** so the Docker build includes `packages/latr-kit` and `services/latr-gateway`:

```bash
bash services/latr-gateway/deploy.sh dev
```

Equivalent:

```bash
fly deploy . --config services/latr-gateway/fly.toml --app latr-link-dev-gateway --remote-only
```

Do not run `fly deploy` from `services/latr-gateway/` alone — the build context must be the repo root.

Mount a volume for registered clients and set secrets (example):

```bash
fly volumes create latr_client_registry --size 1 --app latr-link-dev-gateway

fly secrets set \
  OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT=true \
  OAUTH_GATEWAY_ALLOWED_CLIENT_IDS='https://latr.link/client-metadata.json,https://thesocialwire.app/client-metadata.json' \
  LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true \
  LATR_GATEWAY_CLIENT_REGISTRY_PATH='/data/client-registry.json' \
  LATR_GATEWAY_CLIENT_REGISTRATION_SECRET='REPLACE_ME' \
  --app latr-link-dev-gateway
```

Set `NEXT_PUBLIC_LATR_GATEWAY_URL` (and client key env vars when required) on Vercel for production web builds.

## CI

- **GitHub Actions:** `.github/workflows/ci.yml` — install, Swift LatrKit/gateway test/build, web typecheck/lint/test/build on `main` / `dev`.
- Local equivalent: `bash scripts/ci.sh`

## Social Wire integration

Social Wire can register once against the hosted gateway, persist the returned `apiKey`, and send `X-Latr-Client-Id` / `X-Latr-API-Key` on every `/v1/latr/*` request together with the viewer’s OAuth credentials. This replaces duplicating record orchestration in the native client while keeping the same lexicon semantics as direct PDS writes.
