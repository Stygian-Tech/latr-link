# L@tr gateway

Server-side L@tr API (Swift/Hummingbird). Clients authenticate in two layers:

1. **Application credential** — split headers `X-Latr-Client-Id` + `X-Latr-API-Key` (developer-issued keys from [latrkit.dev](../apps/latrkit-dev.md)), or legacy internal `X-Latr-Official-Client` for env-mapped first-party apps during migration.
2. **User OAuth** — ATProto access token + RFC 9449 DPoP for the signed-in viewer; forwarded to the PDS for `com.atproto.repo.*` mutations.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:8080` (`NEXT_PUBLIC_LATR_GATEWAY_URL`) |
| Fly dev | `https://latr-link-dev-gateway.fly.dev` (after deploy) |

## Auth

### Developer API keys (preferred)

Third-party and [latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)-issued clients send:

| Header | Description |
|--------|-------------|
| `X-Latr-Client-Id` | Registered client id (`^[a-z][a-z0-9-]{0,62}$`) |
| `X-Latr-API-Key` | Opaque key (`lk_…`), shown once at creation |

Keys are hashed at rest (SHA-256). Issue and rotate keys via **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** or the developer management API (OAuth-protected).

When `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` (default in `APP_ENV=prod`), these headers (or legacy official header below) are required on every `/v1/latr/*` route except developer management routes.

### Internal official clients (migration)

Legacy first-party apps may still use:

| Header | Description |
|--------|-------------|
| `X-Latr-Official-Client` | Base64 credential from env map `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` |

Provision new official clients through **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** when `OFFICIAL_CLIENT_DID` matches the signed-in operator DID (`POST /v1/latr/developer/official/clients`). Do not document public base64 self-registration.

Local development (`APP_ENV=local`) skips client credentials by default.

### Developer management API (OAuth + DPoP)

Authenticated with the operator’s ATProto session only (no app API key):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/latr/developer/clients` | List clients owned by signed-in DID |
| POST | `/v1/latr/developer/clients` | Create developer client (`clientId` slug; optional `displayName`, any Unicode) |
| DELETE | `/v1/latr/developer/clients/:clientId` | Delete developer client |
| GET | `/v1/latr/developer/clients/:clientId/keys` | List API keys |
| POST | `/v1/latr/developer/clients/:clientId/keys` | Create API key (shown once) |
| DELETE | `/v1/latr/developer/clients/:clientId/keys/:keyId` | Revoke key |
| POST | `/v1/latr/developer/official/clients` | Provision official client + key (`OFFICIAL_CLIENT_DID` only) |
| GET | `/v1/latr/developer/usage` | Usage summary (preview limits) |

### User OAuth + DPoP

All `/v1/latr/*` save/list routes also require:

- `Authorization: DPoP <access-token-jwt>` (or `Bearer`)
- `DPoP: <dpop-proof-jwt>` bound to the gateway request
- Optional `X-ATProto-Upstream-DPoP: <dpop-proof-jwt>` — PDS-bound proof for write-through

### Auth probe

`POST /v1/latr/auth/probe` — lists one saved item via PDS to confirm write-through credentials. Response includes `clientId` when app credential auth is active.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Public health check |
| POST | `/v1/latr/auth/probe` | Authenticated PDS connectivity check |
| GET | `/v1/latr/saves` | List `com.latr.saved.item` records |
| POST | `/v1/latr/saves` | Save URL or subject |
| GET | `/v1/latr/saves/subject?subjectUri=` | Lookup saved item by subject |
| PATCH | `/v1/latr/saves/:itemRkey/state` | Body: `{ state: "unread" \| "archived" }` |
| DELETE | `/v1/latr/saves/:itemRkey` | Unsave (item edge only) |
| GET | `/v1/latr/discover/at-uri?url=` | Standard.site / HTML AT URI discovery |
| GET | `/v1/latr/og-preview?url=` | Server OG fetch (SSRF guarded) |

Developer management routes are listed above.

Record mutations are implemented in Swift **LatrKit** (`SavedLibrary`). Open Graph metadata is stored on `com.latr.saved.external` / `com.latr.saved.item`.

## Environment variables

Full template: [`services/latr-gateway/.env.example`](../../services/latr-gateway/.env.example).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP listen port |
| `APP_ENV` | No | `local` | `local`, `dev`, `prod`, or `test` |
| `PLC_URL` | No | `https://plc.directory` | PLC directory base URL |
| `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT` | No | `true` when `APP_ENV=prod` | Require JWT client allowlist |
| `OAUTH_GATEWAY_ALLOWED_CLIENT_IDS` | When OAuth policy on | _(empty)_ | OAuth client metadata URLs |
| `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` | No | `true` when `APP_ENV=prod` | Require app credential headers |
| `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` | No | _(empty)_ | Internal legacy `client-id=base64` pairs |
| `OFFICIAL_CLIENT_DID` | No | _(empty)_ | DID allowed to provision official clients |
| `DATABASE_URL` | No | _(empty)_ | Supabase Postgres (run SQL migration) |
| `LATR_GATEWAY_DEVELOPER_STORE_PATH` | No | `./data/developer-store.json` | JSON store for clients/keys/usage |
| `LATR_GATEWAY_CLIENT_REGISTRY_PATH` | No | `./data/client-registry.json` | Legacy JSON registry (deprecated) |

**L@tr web** — `LATR_GATEWAY_CLIENT_CREDENTIAL` or split `LATR_GATEWAY_CLIENT_ID` + `LATR_GATEWAY_API_KEY` via `next.config.ts`.

**The Social Wire** — `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_ID` + `NEXT_PUBLIC_LATR_GATEWAY_API_KEY` (preferred) or legacy `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL`.

## Local development

```bash
# Terminal 1 — gateway
cd services/latr-gateway && swift run LatrGateway

# Terminal 2 — latrkit.dev console (sibling repo)
cd ../latrkit-dev && bun run dev

# Terminal 3 — L@tr.link web
cd apps/web && bun run dev
```

Apply Supabase schema when using `DATABASE_URL`:

```bash
psql "$DATABASE_URL" -f services/latr-gateway/migrations/001_developer_console.sql
```

## Fly deployment (dev)

See existing Fly notes in this file’s git history; mount a volume for `LATR_GATEWAY_DEVELOPER_STORE_PATH` and set `OFFICIAL_CLIENT_DID`, `DATABASE_URL`, and OAuth allowlists via Fly secrets.
