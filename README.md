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

Use [http://127.0.0.1:3000](http://127.0.0.1:3000) for OAuth (loopback). With `next dev`, opening **localhost** or **127.0.0.1** automatically uses loopback OAuth (no fetch to `latr.link`); you can still add `apps/web/.env.local` from `.env.example` for overrides.

### Local OAuth (development)

Loopback OAuth must use a `client_id` that includes your `/callback` path and repo scopes. `apps/web/.env.local` should set `NEXT_PUBLIC_APP_ENV=local` (already in `.env.example`).

Prefer **`http://127.0.0.1:3000`** in the browser so the redirect URI matches ATProto loopback rules (see `@atproto/oauth-client-browser` README — the library may rewrite `localhost` to loopback IP).

Optional environment variables (see `apps/web/.env.example`):

- `NEXT_PUBLIC_LOCAL_REDIRECT_URI` — if your dev URL is not the default `http://127.0.0.1:<port>/callback`.
- `NEXT_PUBLIC_LOCAL_OAUTH_CLIENT_ID` — full custom loopback `client_id` URL (advanced override).

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
