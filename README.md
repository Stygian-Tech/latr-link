# L@tr (latr.link)

Read-later on your own ATProto repo. Saved state lives in `com.latr.saved.item` and `com.latr.saved.external` — no Stygian backend required for core functionality.

```
Next.js (latr.link)  ── ATProto OAuth ──►  Your PDS
                         XRPC            com.latr.saved.item
                                         com.latr.saved.external
```

## Monorepo layout

```
latr-link/
  apps/
    web/           # Next.js web client (Bun)
  packages/
    lexicons/    # com.latr.* lexicon JSON
    latr-kit/    # URL normalization, rkey helpers, shared types
  docs/
    architecture/
```

## Prerequisites

| Tool | Version |
|------|---------|
| [Bun](https://bun.sh) | ≥ 1.2 |

## Quick start

```bash
bun install
cd apps/web
cp .env.example .env.local
bun run dev
```

With `next dev` **or** `next start`, opening **`http://127.0.0.1:3000`** or **`http://localhost:3000`** uses **loopback OAuth automatically** (no fetch to `latr.link` for client metadata). You do **not** need `NODE_ENV=development` for that. Optional `apps/web/.env.local` from `.env.example` tweaks timeouts and redirects.

### Local OAuth (development)

Loopback OAuth must use a `client_id` that includes your `/callback` path and repo scopes. `apps/web/.env.local` should set `NEXT_PUBLIC_APP_ENV=local` (already in `.env.example`).

**Production:** set **`NEXT_PUBLIC_APP_ENV=prod`** on the host—if **`NEXT_PUBLIC_APP_ENV`** is unset at build/runtime, it defaults to **`local`**, which shows LOCAL-only UI on the live site. See **`apps/web/.env.example`** for **`prod`** / **`local`** / **`dev`** behavior.

Prefer **`http://127.0.0.1:3000`** in the browser so the redirect URI matches ATProto loopback rules (see `@atproto/oauth-client-browser` README — the library may rewrite `localhost` to loopback IP).

Optional environment variables (see `apps/web/.env.example`):

- `NEXT_PUBLIC_LOCAL_REDIRECT_URI` — if your dev URL is not the default `http://127.0.0.1:<port>/callback`.
- `NEXT_PUBLIC_LOCAL_OAUTH_CLIENT_ID` — full custom loopback `client_id` URL (advanced override).
- `NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS` — cap OAuth/IndexedDB restore wait in ms (default 8000) so the UI cannot stay on “Loading…” forever in embedded or broken browsers.

### WebSocket / HMR errors in an embedded browser

If the console shows `WebSocket connection to .../_next/webpack-hmr` failures, hot reload may not work in that environment; the app should still load. Use an external browser if the page stays blank after refresh.

### Commands (repo root)

| Script | Description |
|--------|-------------|
| `bun run dev` | Turbo dev (web app) |
| `bun run build` | Production build |
| `bun run lint` | ESLint |
| `bun run typecheck` | TypeScript |
| `bun run test` | Unit tests (workspace) |

## Architecture

See [docs/architecture/overview.md](docs/architecture/overview.md).

## Lexicons

See [packages/lexicons/README.md](packages/lexicons/README.md).
