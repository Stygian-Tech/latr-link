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

All `/xrpc/link.latr.*` and `/v1/latr/*` save/list routes also require:

- `Authorization: DPoP <access-token-jwt>` (or `Bearer`)
- `DPoP: <dpop-proof-jwt>` bound to the gateway request
- Optional `X-ATProto-Upstream-DPoP: <dpop-proof-jwt[, ...]>` — one PDS-bound proof per write-through call

`POST /xrpc/link.latr.bookmarks.migrateLegacy` needs a larger proof pool for its atomic migration pass. Current clients send that pool in the JSON `upstreamDpopProof` transport field to stay below reverse-proxy header limits.

### Auth probe

`POST /v1/latr/auth/probe` — lists one saved item via PDS to confirm write-through credentials. Response includes `clientId` when app credential auth is active.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Public health check |
| GET | `/xrpc/link.latr.bookmarks.listBookmarks` | Page bookmark views (`value`, optional `metadataRecord`, optional `preview`) |
| GET | `/xrpc/link.latr.bookmarks.getBookmark?subject=` | Exact-subject lookup |
| POST | `/xrpc/link.latr.bookmarks.saveBookmark` | Idempotent exact-subject save |
| POST | `/xrpc/link.latr.bookmarks.syncMetadata` | Reconcile one bookmark page with same-rkey L@tr metadata |
| POST | `/xrpc/link.latr.bookmarks.setState` | Update metadata state using bookmark URI |
| POST | `/xrpc/link.latr.bookmarks.deleteBookmark` | Atomically delete bookmark and metadata by URI |
| POST | `/xrpc/link.latr.bookmarks.migrateLegacy` | Retry-safe legacy migration with counts and cursor |
| POST | `/v1/latr/auth/probe` | Authenticated PDS connectivity check |
| GET/POST/PATCH/DELETE | `/v1/latr/*` save routes | One-release deprecated adapters over bookmark XRPC; never write legacy collections |
| GET | `/v1/latr/saves/subject?subjectUri=` | Lookup saved item by subject |
| PATCH | `/v1/latr/saves/:itemRkey/state` | Body: `{ state: "unread" \| "archived" }` |
| DELETE | `/v1/latr/saves/:itemRkey` | Unsave (item edge only) |
| GET | `/v1/latr/discover/at-uri?url=` | Debug: HEAD AT URI + Bluesky URL normalization |
| GET | `/v1/latr/og-preview?url=` | Server OG fetch (SSRF guarded) |

Developer management routes are listed above.

Record mutations are implemented in Swift **LatrKit** (`SavedLibrary`). `community.lexicon.bookmarks.bookmark` is authoritative, `link.latr.bookmarks.metadata` stores user state, and Open Graph previews are service-derived cache data rather than PDS record fields. See [the migration contract](community-bookmark-migration.md).

**Client read path:** best-effort reconcile the requested page through **`POST /xrpc/link.latr.bookmarks.syncMetadata`**, then list it through **`GET /xrpc/link.latr.bookmarks.listBookmarks`**. Clients do not join community and metadata collections themselves, and a reconciliation failure does not hide community bookmarks.

## Bookmark save pipeline

Clients call **`POST /xrpc/link.latr.bookmarks.saveBookmark { subject, tags? }`**. The exact trimmed subject is stored; discovery and preview enrichment never replace an encountered HTTPS URL with an AT URI. Existing exact-subject records are adopted deterministically.

The gateway fetches HTTP(S) Open Graph fields as best-effort cache enrichment. Cache failure never blocks the PDS bookmark write. A successful response has the same bookmark-view shape used by list and get:

```json
{
  "uri": "at://did:plc:…/community.lexicon.bookmarks.bookmark/3m…",
  "cid": "bafy…",
  "value": {
    "$type": "community.lexicon.bookmarks.bookmark",
    "subject": "https://example.com/encountered",
    "createdAt": "2026-08-13T20:00:00Z"
  },
  "metadataRecord": { "uri": "at://…/link.latr.bookmarks.metadata/3m…", "cid": "bafy…", "value": { "state": "unread" } },
  "preview": { "title": "Example" }
}
```

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
| `DATABASE_URL` | Yes on Railway | _(empty)_ | Private Railway Postgres URL for developer data and the subject-keyed bookmark preview cache |
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
