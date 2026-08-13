# L@tr gateway

Server-side L@tr API (Swift/Hummingbird). Clients authenticate in two layers:

1. **Application credential** — split headers `X-Latr-Client-Id` + `X-Latr-API-Key` (developer-issued keys from [latrkit.dev](../apps/latrkit-dev.md)), or legacy internal `X-Latr-Official-Client` for env-mapped first-party apps during migration.
2. **User OAuth** — ATProto access token + RFC 9449 DPoP for the signed-in viewer; forwarded to the PDS for `com.atproto.repo.*` mutations.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:8080` (`NEXT_PUBLIC_LATR_GATEWAY_URL`) |
| Development | `https://api.testing.latr.link` |
| Production | `https://api.latr.link` |

## Auth

### Developer API keys (preferred)

Third-party and [latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)-issued clients send:

| Header | Description |
|--------|-------------|
| `X-Latr-Client-Id` | Registered client id (`^[a-z][a-z0-9_-]{0,62}$`) |
| `X-Latr-API-Key` | Opaque key (`lk_…`), shown once at creation |

Keys are hashed at rest (SHA-256). Issue and rotate keys via **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** or the developer management API (OAuth-protected).

When `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` (default in `APP_ENV=prod`), these headers (or the legacy official header below) are required on product `/xrpc/link.latr.*` methods. Developer-management XRPC methods use OAuth only.

### Legacy env credentials (migration)

Legacy first-party apps may still use:

| Header | Description |
|--------|-------------|
| `X-Latr-Official-Client` | Base64 credential from env map `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS` |

Register new clients (including first-party apps) through **[latrkit.dev](https://github.com/Stygian-Tech/latrkit-dev)** like any other developer: create a client, issue an API key, and configure `X-Latr-Client-Id` + `X-Latr-API-Key` in your app. Client records are not labeled differently in the console or management API.

Local development (`APP_ENV=local`) skips client credentials by default.

### Developer management API (OAuth + DPoP)

Authenticated with the operator’s ATProto session only (no app API key):

| Kind | XRPC method | Description |
|--------|------|-------------|
| Query | `link.latr.developer.listClients` | List clients owned by signed-in DID |
| Procedure | `link.latr.developer.createClient` | Create a developer client |
| Procedure | `link.latr.developer.deleteClient` | Delete a developer client |
| Query | `link.latr.developer.listKeys` | List API keys |
| Procedure | `link.latr.developer.createKey` | Create an API key (shown once) |
| Procedure | `link.latr.developer.revokeKey` | Revoke an API key |
| Query | `link.latr.developer.getUsage` | Usage summary |

### User OAuth + DPoP

All product XRPC methods also require:

- `Authorization: DPoP <access-token-jwt>` (or `Bearer`)
- `DPoP: <dpop-proof-jwt>` bound to the gateway request
- Optional `X-ATProto-Upstream-DPoP: <dpop-proof-jwt[, ...]>` — one PDS-bound proof per write-through call

`POST /v1/latr/migrate-lexicons` needs a larger proof pool for its copy/delete pass. Current clients send that pool as JSON (`{ "upstreamDpopProof": "<jwt,...>" }`) to stay below reverse-proxy header limits. The gateway still accepts the header form for older clients.

### Auth probe

`GET /xrpc/link.latr.auth.probe` lists one saved item via the PDS to confirm write-through credentials. The response includes `clientId` when application-credential auth is active.

## XRPC methods

Queries use `GET /xrpc/<nsid>` with URL parameters. Procedures use `POST /xrpc/<nsid>` with `application/json` input. Successful methods return `200` JSON; errors use `{ "error", "message" }`.

| Kind | NSID | Description |
|--------|------|-------------|
| Query | `link.latr.saved.listItems` | Paginated saved-item records (`limit` 1–100, optional `cursor`) |
| Query | `link.latr.saved.getItem` | Lookup by `subjectUri` |
| Procedure | `link.latr.saved.saveUrl` | Save `{ url }` |
| Procedure | `link.latr.saved.saveSubject` | Save `{ subjectUri, linkedWebUrl? }` |
| Procedure | `link.latr.saved.setState` | Set `{ itemRkey, state }` |
| Procedure | `link.latr.saved.deleteItem` | Delete `{ itemRkey }` |
| Procedure | `link.latr.saved.migrateLegacy` | Explicit legacy collection migration |
| Query | `link.latr.discovery.resolveUrl` | Discover an AT URI from `url` |
| Query | `link.latr.preview.getOpenGraph` | SSRF-guarded Open Graph fetch for `url` |
| Query | `link.latr.auth.probe` | Authenticated PDS connectivity check |

`GET /health` and OAuth client-metadata documents intentionally remain non-XRPC. The old `/v1/latr/*` routes are compatibility adapters during migration and are not the preferred public contract.

The compatibility `GET /v1/latr/saves` route retains its legacy full-list behavior when `limit` is omitted. With `limit` (1–100) and optional `cursor`, it returns one page without performing migration. Legacy migration remains an explicit `POST /v1/latr/migrate-lexicons` operation.

Developer management routes are listed above.

Record mutations are implemented in Swift **LatrKit** (`SavedLibrary`). Open Graph metadata is stored on `link.latr.saved.external` / `link.latr.saved.item`.

**Client read path:** list saved items via `link.latr.saved.listItems` (not direct PDS `listRecords`). Queries never run the legacy mutation; clients invoke `link.latr.saved.migrateLegacy` explicitly when needed.

## URL save pipeline

Clients should call **`POST /xrpc/link.latr.saved.saveUrl`** with `{ "url": "https://…" }`. The gateway runs a single SSRF-safe fetch and:

1. **Native subject discovery** — Bluesky profile/post URLs normalize to `at://…/app.bsky.feed.post/…`; otherwise scan early `<head>` for any canonical `at://did/collection/rkey` in `<link href>` or `<meta content>` (Standard.site is one supported pattern, not the only one). Wrapper `link.latr.saved.external` URIs in HEAD are deprioritized.
2. **Subject metadata** — For native subjects, resolve on-protocol preview fields: **PDS-first** `com.atproto.repo.getRecord` (from the repo DID document via PLC or `did:web`), **AppView enrichment** for Bluesky posts by trying AppView services discovered from the subject repo’s DID document (`#bsky_appview`, `#atproto_appview`, `BskyAppView`, `AtprotoAppView`), then `LATR_GATEWAY_APPVIEW_URLS`, then `https://public.api.bsky.app`, then raw PDS post text. Handle → DID uses `LATR_GATEWAY_IDENTITY_URL` (default `https://bsky.social`).
3. **HEAD Open Graph gap-fill** — Parse OG from the HEAD slice only; subject-derived fields win, OG fills empty `preview*` slots.

Direct **`POST /xrpc/link.latr.saved.saveSubject`** with `{ "subjectUri": "at://…", "linkedWebUrl": "https://…" }` remains for rare `at://` paste.

**Save response** (`200`):

```json
{
  "ok": true,
  "kind": "subject",
  "subjectUri": "at://did:plc:…/app.bsky.feed.post/…",
  "linkedWebUrl": "https://…",
  "storage": "native"
}
```

`storage`: `"native"` = saved edge points at a non-wrapper AT URI; `"external"` = subject is a `link.latr.saved.external` wrapper.

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
| `DATABASE_URL` | Yes on Railway | _(empty)_ | Private Railway Postgres URL for developer clients, API keys, and usage |
| `LATR_GATEWAY_DEVELOPER_STORE_PATH` | No | `./data/developer-store.json` | JSON fallback when `DATABASE_URL` is unset (local dev) |
| `LATR_GATEWAY_CLIENT_REGISTRY_PATH` | No | `./data/client-registry.json` | Legacy JSON registry (deprecated) |

**L@tr web** — `LATR_GATEWAY_CLIENT_CREDENTIAL` or split `LATR_GATEWAY_CLIENT_ID` + `LATR_GATEWAY_API_KEY` are server-only secrets. Browser calls go to the same-origin Next.js proxy at `/api/latr-gateway/*`; the proxy forwards OAuth/DPoP headers and injects gateway client credentials server-side.

On Railway, set `LATR_GATEWAY_INTERNAL_URL=http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:8080`
on Web. This changes only the server-to-server hop; browser-visible OAuth/DPoP
identities continue to use the public custom domains.

**The Social Wire** — `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_ID` + `NEXT_PUBLIC_LATR_GATEWAY_API_KEY` (preferred) or legacy `NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL`.

## Local development

```bash
# Terminal 1 — gateway
cd services/latr-gateway && swift run LatrGateway

# Terminal 2 — latrkit.dev console
cd apps/latrkit-dev && bun run dev

# Terminal 3 — L@tr.link web
cd apps/web && bun run dev
```

Apply the provider-neutral migration history when using `DATABASE_URL`:

```bash
bash scripts/apply-database-migrations.sh
```

## Railway deployment

Railway builds Gateway from `/railway/gateway.json`. Its pre-deploy command
applies migrations through the private `DATABASE_URL` reference before starting
the new release. GitHub Actions runs tests only and never mutates hosted data.
See [the Railway runbook](../deployment/railway.md).
