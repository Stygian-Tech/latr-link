# L@tr gateway

Server-side L@tr API (Swift/Hummingbird) compatible with The Social Wire’s gateway direction. Clients authenticate in two layers:

1. **Official client credential** — base64 shared secret identifying the application (`latr-web`, `social-wire`, …).
2. **User OAuth** — ATProto access token + RFC 9449 DPoP for the signed-in viewer; forwarded to the PDS for `com.atproto.repo.*` mutations.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:8080` (`NEXT_PUBLIC_LATR_GATEWAY_URL`) |
| Fly dev | `https://latr-link-dev-gateway.fly.dev` (after deploy) |

## Auth

### Official client credentials

First-party apps send a single header:

| Header | Description |
|--------|-------------|
| `X-Latr-Official-Client` | Base64 credential shared between gateway and client env |

When `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` (default in `APP_ENV=prod`), this header is required on every `/v1/latr/*` route (except the registration routes below).

Credentials come from either:

- **Official env** — `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS=latr-web:<base64>,social-wire:<base64>` (same pattern as shared secrets between Social Wire gateway and AppView)
- **Client registration API** — persisted to `LATR_GATEWAY_CLIENT_REGISTRY_PATH` (returns a new base64 credential once)

Generate a credential: `openssl rand -base64 32`. Set the same value on the gateway (in the `client-id=` pair) and on the client (`NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL` or `VITE_LATR_GATEWAY_CLIENT_CREDENTIAL`).

**L@tr web** — set `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL` when calling a hosted gateway that enforces credentials. This ships in the browser bundle; use a `latr-web`-scoped credential with rate limits.

**The Social Wire** — set the `social-wire` credential in gateway env and `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL` on web (or register via API for a one-off credential).

Local development (`APP_ENV=local`) skips client credentials by default.

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
  "clientCredential": "…base64…",
  "displayName": "The Social Wire",
  "createdAt": "2026-05-24T00:00:00Z"
}
```

Store `clientCredential` immediately — it is shown once. Only a SHA-256 hash is persisted.

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

`POST /v1/latr/auth/probe` — lists one saved item via PDS to confirm write-through credentials. Response includes `clientId` when official client auth is active.

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
| `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` | No | `true` when `APP_ENV=prod` | Require `X-Latr-Official-Client` |
| `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` | No | _(empty)_ | Official `client-id=base64-credential` pairs (comma/semicolon separated) |
| `LATR_GATEWAY_CLIENT_REGISTRY_PATH` | No | `./data/client-registry.json` | JSON file for registered clients |
| `LATR_GATEWAY_CLIENT_REGISTRATION_SECRET` | Dev/prod registration | _(unset)_ | Bearer secret for client registration routes |

**Web client (Vercel / `.env.local`):**

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_LATR_GATEWAY_URL` | Gateway base URL (default `http://127.0.0.1:8080`) |
| `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL` | Base64 official credential for `latr-web` when hosted gateway requires it |

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

Fly builds from **`services/latr-gateway/`** (the app directory). `deploy.sh` runs `prepare-docker.sh` (no-op; LatrKit resolves from GitHub in SwiftPM), then builds the Docker image.

```bash
bash services/latr-gateway/deploy.sh dev
```

Manual steps from `services/latr-gateway/`:

```bash
bash prepare-docker.sh
fly deploy --config fly.toml --app latr-link-dev-gateway --remote-only
```

CI deploys via **GitHub Actions** (`scripts/fly-deploy-gateway.sh` → `deploy.sh`, which runs `prepare-docker.sh` before `fly deploy --config fly.toml`).

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

- **GitHub Actions:** `.github/workflows/ci.yml` — `bash scripts/ci.sh` on pushes and pull requests to `main` and `dev`; on push (or manual workflow dispatch with **Deploy latr-gateway**), deploys `services/latr-gateway` to Fly when gateway-related paths change.
- Local equivalent: `bash scripts/ci.sh`
- Fly deploy from CI requires GitHub secret **`FLY_API_TOKEN`**; optional **`FLY_GATEWAY_APP_DEV`**, **`FLY_GATEWAY_APP_PROD`**, **`FLY_ORG`**.

## Social Wire integration

Social Wire can configure the `social-wire` credential in gateway and web env (or register once and persist `clientCredential`), then send `X-Latr-Official-Client` on every `/v1/latr/*` request together with the viewer’s OAuth credentials. This replaces duplicating record orchestration in the native client while keeping the same lexicon semantics as direct PDS writes.
