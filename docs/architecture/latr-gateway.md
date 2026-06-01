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
| `X-Latr-Client-Id` | Registered client id (`^[a-z][a-z0-9_-]{0,62}$`) |
| `X-Latr-API-Key` | Opaque key (`lk_…`), shown once at creation |

Keys are hashed at rest (SHA-256). Issue and rotate keys via **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** or the developer management API (OAuth-protected).

When `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` (default in `APP_ENV=prod`), these headers (or legacy official header below) are required on every `/v1/latr/*` route except developer management routes.

### Legacy env credentials (migration)

Legacy first-party apps may still use:

| Header | Description |
|--------|-------------|
| `X-Latr-Official-Client` | Base64 credential from env map `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` |

Register new clients (including first-party apps) through **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** like any other developer: create a client, issue an API key, and configure `X-Latr-Client-Id` + `X-Latr-API-Key` in your app. Client records are not labeled differently in the console or management API.

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
| GET | `/v1/latr/discover/at-uri?url=` | Debug: HEAD AT URI + Bluesky URL normalization |
| GET | `/v1/latr/og-preview?url=` | Server OG fetch (SSRF guarded) |

Developer management routes are listed above.

Record mutations are implemented in Swift **LatrKit** (`SavedLibrary`). Open Graph metadata is stored on `com.latr.saved.external` / `com.latr.saved.item`.

**Client read path:** list saved items via **`GET /v1/latr/saves`** (not direct PDS `listRecords`). L@tr.link and The Social Wire use the gateway for list, save, archive, and delete so app credentials and OAuth policy apply consistently.

## URL save pipeline

Clients should call **`POST /v1/latr/saves { kind: "url", url }`** only. The gateway runs a single SSRF-safe fetch and:

1. **Native subject discovery** — Bluesky profile/post URLs normalize to `at://…/app.bsky.feed.post/…`; otherwise scan early `<head>` for any canonical `at://did/collection/rkey` in `<link href>` or `<meta content>` (Standard.site is one supported pattern, not the only one). Wrapper `com.latr.saved.external` URIs in HEAD are deprioritized.
2. **Subject metadata** — For native subjects, resolve on-protocol preview fields: **PDS-first** `com.atproto.repo.getRecord` (from the repo DID document via PLC or `did:web`), **AppView enrichment** for Bluesky posts by trying AppView services discovered from the subject repo’s DID document (`#bsky_appview`, `#atproto_appview`, `BskyAppView`, `AtprotoAppView`), then `LATR_GATEWAY_APPVIEW_URLS`, then `https://public.api.bsky.app`, then raw PDS post text. Handle → DID uses `LATR_GATEWAY_IDENTITY_URL` (default `https://bsky.social`).
3. **HEAD Open Graph gap-fill** — Parse OG from the HEAD slice only; subject-derived fields win, OG fills empty `preview*` slots.

Direct **`POST /v1/latr/saves { kind: "subject", subjectUri, linkedWebUrl? }`** remains for rare `at://` paste.

**Save response** (201):

```json
{
  "ok": true,
  "kind": "subject",
  "subjectUri": "at://did:plc:…/app.bsky.feed.post/…",
  "linkedWebUrl": "https://…",
  "storage": "native"
}
```

`storage`: `"native"` = saved edge points at a non-wrapper AT URI; `"external"` = subject is a `com.latr.saved.external` wrapper.

## Environment variables

Full template: [`services/latr-gateway/.env.example`](../../services/latr-gateway/.env.example).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP listen port |
| `APP_ENV` | No | `local` | `local`, `dev`, `prod`, or `test` |
| `PLC_URL` | No | `https://plc.directory` | PLC directory base URL |
| `LATR_GATEWAY_APPVIEW_URLS` | No | `https://public.api.bsky.app` | Fallback AppView bases after DID-document discovery |
| `LATR_GATEWAY_IDENTITY_URL` | No | `https://bsky.social` | Identity relay for handle → DID resolution |
| `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT` | No | `true` when `APP_ENV=prod` | Require registered gateway client id + API key from the developer store |
| `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` | No | `true` when `APP_ENV=prod` | Require app credential headers |
| `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` | No | _(empty)_ | Internal legacy `client-id=base64` pairs |
| `DATABASE_URL` | Yes on Fly | _(empty)_ | Supabase Postgres for developer clients, API keys, and usage (`migrations/001_developer_console.sql`) |
| `LATR_GATEWAY_DEVELOPER_STORE_PATH` | No | `./data/developer-store.json` | JSON fallback when `DATABASE_URL` is unset (local dev) |
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

Set `DATABASE_URL` as a Fly secret (Supabase Postgres). CI applies `migrations/001_developer_console.sql` before each gateway deploy when gateway paths change on `dev`/`main` (GitHub secrets `GATEWAY_DATABASE_URL_DEV` / `GATEWAY_DATABASE_URL_PROD`, or `DATABASE_URL` fallback).

```bash
fly secrets set DATABASE_URL='postgresql://...' -a latr-link-dev-gateway
bash services/latr-gateway/deploy.sh dev
```

Also set `DATABASE_URL` and `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT` via Fly secrets as needed. Register third-party apps in the developer console (`DATABASE_URL`); no static OAuth client allowlist is required.
