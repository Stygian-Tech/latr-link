# L@tr gateway

Server-side L@tr API (Swift/Hummingbird) compatible with The Social Wire’s gateway direction. Clients authenticate with ATProto OAuth access tokens and RFC 9449 DPoP; the gateway forwards credentials to the viewer’s PDS for `com.atproto.repo.*` mutations.

## Base URL

| Environment | URL |
|-------------|-----|
| Local | `http://127.0.0.1:8080` (`NEXT_PUBLIC_LATR_GATEWAY_URL`) |
| Fly dev | `https://latr-link-dev-gateway.fly.dev` (after deploy) |

## Auth

All `/v1/latr/*` routes require:

- `Authorization: DPoP <access-token-jwt>` (or `Bearer`)
- `DPoP: <dpop-proof-jwt>` bound to the gateway request
- Optional `X-ATProto-Upstream-DPoP: <dpop-proof-jwt>` — PDS-bound proof for write-through (preferred when the client can mint it)

Gateway verifies token structure (`sub` DID, `exp`) and optional first-party client allowlists:

- `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT=true`
- `OAUTH_GATEWAY_ALLOWED_CLIENT_IDS=https://latr.link/client-metadata.json`

### Auth probe

`POST /v1/latr/auth/probe` — lists one saved item via PDS to confirm write-through credentials.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Public health check |
| POST | `/v1/latr/auth/probe` | Authenticated PDS connectivity check |
| GET | `/v1/latr/saves` | List `com.latr.saved.item` records |
| POST | `/v1/latr/saves` | Save URL (`{ kind: "url", url }`) or subject (`{ kind: "subject", subjectUri, linkedWebUrl? }`) |
| GET | `/v1/latr/saves/subject?subjectUri=` | Lookup saved item by subject |
| PATCH | `/v1/latr/saves/:itemRkey/state` | Body: `{ state: "unread" \| "archived" }` |
| DELETE | `/v1/latr/saves/:itemRkey` | Unsave (item edge only) |
| GET | `/v1/latr/discover/at-uri?url=` | Standard.site / HTML AT URI discovery |
| GET | `/v1/latr/og-preview?url=` | Server OG fetch (SSRF guarded) |

Record mutations are implemented in the Swift gateway (ported from `packages/latr-kit` workflows). Open Graph metadata is stored on `com.latr.saved.external` (URL saves) and `com.latr.saved.item` preview fields (native subjects with `linkedWebUrl`).

## Local development

```bash
# Terminal 1 — gateway (Swift/Hummingbird)
cd services/latr-gateway && swift run LatrGateway

# Terminal 2 — web (uses NEXT_PUBLIC_LATR_GATEWAY_URL or http://127.0.0.1:8080)
cd apps/web && bun run dev
```

Sign in at `http://127.0.0.1:3000`, then save/list/archive via the library UI.

## Fly deployment (dev)

```bash
bash services/latr-gateway/deploy.sh dev
```

Secrets (example):

```bash
fly secrets set OAUTH_GATEWAY_ALLOWED_CLIENT_IDS='https://latr.link/client-metadata.json' --app latr-link-dev-gateway
```

Set `NEXT_PUBLIC_LATR_GATEWAY_URL` on Vercel to the Fly app URL for production web builds.

## CI

- **Tangled Spindle:** `.tangled/workflows/ci.yml` — install, Swift gateway test/build, web typecheck/lint/test/build on `main` / `dev`.
- Local equivalent: `bash scripts/ci.sh`

## Social Wire integration

Social Wire today writes L@tr records directly to the user PDS with aligned lexicons and rkeys. This gateway exposes the same semantics over HTTP so native clients (or a future Social Wire gateway extension) can call `/v1/latr/*` instead of duplicating record orchestration.
