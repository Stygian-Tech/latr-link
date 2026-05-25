## Workspace facts

- **Git — GitHub is primary (`origin`).** Push and CI run on **`origin`** (`github.com/Stygian-Tech/latr-link`). Fly deploy is triggered from **GitHub Actions** (`.github/workflows/ci.yml`). A **`tangled`** remote may exist but is not used for CI/deploy right now — default: `git push origin <branch>`. **`dev`** / **`main`** track **`origin/*`**; repo **`remote.pushDefault=origin`**.
- Monorepo root: Bun workspaces (`apps/*`, `packages/*`, `services/*`) + Turborepo. Pin **Bun 1.3.14** (`package.json` `packageManager` + `.github/workflows/ci.yml`) — `bun.lockb` requires Bun 1.3.x.
- Web app: `apps/web` (package name `web`). Run checks with `bash scripts/ci.sh` or `bun run turbo run build --filter=web...`.
- Gateway: `services/latr-gateway` — Swift/Hummingbird HTTP service: registered client API keys + OAuth/DPoP gate, PDS write-through for L@tr saves. Local: `cd services/latr-gateway && swift run LatrGateway` (port 8080). Web uses `NEXT_PUBLIC_LATR_GATEWAY_URL`. Gateway env vars: `services/latr-gateway/.env.example`. Fly/Docker **build context** is the gateway directory (not repo root): `bash deploy.sh dev` runs `prepare-docker.sh` (stages `packages/latr-kit` → `vendor/latr-kit`), then `fly deploy --config fly.toml`.
- Shared logic: **`packages/latr-kit`** — Swift **`LatrKit`** framework (Apple-style API) for all server-side record workflows.

## Conventions

- ATProto OAuth scopes must match `apps/web/public/client-metadata.json` — users must re-auth after scope changes.
- Local dev: loopback OAuth activates on **localhost / 127.0.0.1** without requiring `NODE_ENV=development` (works with `next start` too). Optional `NEXT_PUBLIC_APP_ENV=local` in `apps/web/.env.local`. Timeouts: `NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS`, `NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS` — see `apps/web/.env.example`. Auth UI also forces loading off after 4s (`useAuth` failsafe). Use `http://127.0.0.1:3000` when testing OAuth.
- **Hosted / prod:** **`NEXT_PUBLIC_APP_ENV=prod`** must be set in Vercel (or any host): in the client bundle, a missing **`NEXT_PUBLIC_APP_ENV`** reads as **`local`** (`environmentBanner.ts`), so the public site inherits LOCAL ribbons and other dev cues. Full value list lives in **`apps/web/.env.example`**. Avoid hydration mismatches: stable root `<html>`/`<body>` (`suppressHydrationWarning`), env banner via CSS class (not inline html styles), URL-dependent UI via `useSyncExternalStore`, fixed locale (e.g. `en-US`) for `Intl` date formatting.

## Learned User Preferences

- Canonical user-facing product title/branding: **L@tr.link** (metadata and primary headings), not abbreviated variants unless requested.
- When following an attached implementation plan in this repo: do not edit the plan artifact; reuse existing todos and update their status rather than creating duplicates.
- Favicon and Apple touch icons should be PNGs with transparency outside the blue squircle; OG/social artwork can remain full-bleed.
- Server-side code in this repo should be **Swift on Hummingbird** (replace TypeScript/Bun services rather than adding parallel runtimes).
- **`LatrKit` is Swift-only** with Apple-style API naming (`SavedLibrary`, `RepositoryClient`, preposition-first methods); web lexicon types live in `apps/web`, not a TypeScript package under `packages/latr-kit`.
- Prefer **on-protocol storage** for saved metadata, including Open Graph fields on `com.latr.saved.*` records.

## Learned Workspace Facts

- **the-social-wire**: sibling Turborepo (`../the-social-wire`) — integrates with L@tr via **latr-gateway HTTP** (register `social-wire` client API key + viewer OAuth/DPoP), not a Swift `LatrKit` import in the web app.
- **Gateway client auth**: registered apps (`latr-web`, `social-wire`, …) send `X-Latr-Client-Id` / `X-Latr-API-Key` on `/v1/latr/*` (enforced when `APP_ENV=prod`); register via `POST /v1/latr/clients/register`. See `docs/architecture/latr-gateway.md`.
- **LatrKit packaging**: keep in monorepo while gateway is the sole Swift consumer; extract to a public SPI repo when a second Swift client or gateway-only Docker context is needed — TS/web clients integrate via gateway HTTP, not `import LatrKit`.
- **latr.link** product shape: ATProto read-later — saved data lives as `com.latr.saved.external` / `com.latr.saved.item` on the signed-in user’s PDS with Open Graph metadata stored on-protocol (`packages/latr-kit`, `packages/lexicons`). Save/list/state run through `services/latr-gateway` (web is a thin OAuth client); see `docs/architecture/latr-gateway.md`.
- **GitHub Actions CI**: `.github/workflows/ci.yml` on **`origin`** — runs `bash scripts/ci.sh` on pushes/PRs to `main` and `dev`; on push, deploys latr-gateway to Fly when gateway paths change (`scripts/fly-deploy-gateway.sh`, GitHub secret **`FLY_API_TOKEN`**).
