## Workspace facts

- **Git — GitHub is primary (`origin`).** Push and CI run on **`origin`** (`github.com/Stygian-Tech/latr-link`). Fly deploy is triggered from **GitHub Actions** (`.github/workflows/ci.yml`). A **`tangled`** remote may exist but is not used for CI/deploy right now — default: `git push origin <branch>`. **`dev`** / **`main`** track **`origin/*`**; repo **`remote.pushDefault=origin`**.
- Monorepo root: Bun workspaces (`apps/*`, `packages/*`, `services/*`) + Turborepo. Pin **Bun 1.3.14** (`package.json` `packageManager` + `.github/workflows/ci.yml`) — `bun.lockb` requires Bun 1.3.x.
- Web app: `apps/web` (package name `web`). Browser extension: `apps/extension` (Chromium/Firefox/Safari via WXT). Shared save client: `packages/latr-web-client`. Run checks with `bash scripts/ci.sh` or `bun run turbo run build --filter=web...` / `--filter=extension...`.
- Gateway: `services/latr-gateway` — Swift/Hummingbird HTTP service: registered client API keys + OAuth/DPoP gate, PDS write-through for L@tr saves. Local: `cd services/latr-gateway && swift run LatrGateway` (port 8080). Web uses `NEXT_PUBLIC_LATR_GATEWAY_URL`. Gateway env vars: `services/latr-gateway/.env.example`. Fly/Docker **build context** is the gateway directory only (not repo root); deploy via `scripts/fly-deploy-gateway.sh` (CI) or `fly deploy --config fly.toml` from `services/latr-gateway`.
- **LatrKit** canonical source: https://github.com/Stygian-Tech/latr-kit — `services/latr-gateway/Package.swift` resolves it via SwiftPM (pinned `revision`; Docker/Fly builds fetch from GitHub, not monorepo `packages/latr-kit`).
- Web TS contracts: **`latr-packages`** git dependency at repo root (`github:Stygian-Tech/latr-packages#<commit>`); import via `latr-packages/gateway-client` and `latr-packages/record-keys` with `transpilePackages: ["latr-packages"]` in `next.config.ts`.

## Conventions

- ATProto OAuth scopes must match `apps/web/public/client-metadata.json` — users must re-auth after scope changes.
- Local dev: loopback OAuth activates on **localhost / 127.0.0.1** without requiring `NODE_ENV=development` (works with `next start` too). Optional `NEXT_PUBLIC_APP_ENV=local` in `apps/web/.env.local`. Timeouts: `NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS`, `NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS` — see `apps/web/.env.example`. Auth UI also forces loading off after 4s (`useAuth` failsafe). Use `http://127.0.0.1:3000` when testing OAuth.
- **Hosted / prod:** **`NEXT_PUBLIC_APP_ENV=prod`** must be set in Vercel (or any host): in the client bundle, a missing **`NEXT_PUBLIC_APP_ENV`** reads as **`local`** (`environmentBanner.ts`), so the public site inherits LOCAL ribbons and other dev cues. Full value list lives in **`apps/web/.env.example`**. **`latr-web-client`** also maps hosted web hostnames to gateway URLs when `NEXT_PUBLIC_LATR_GATEWAY_URL` is unset (`testing.latr.link` → `api.testing.latr.link`; `latr.link`/`www.latr.link` → prod Fly) so saves do not fall back to loopback. Avoid hydration mismatches: stable root `<html>`/`<body>` (`suppressHydrationWarning`), env banner via CSS class (not inline html styles), URL-dependent UI via `useSyncExternalStore`, fixed locale (e.g. `en-US`) for `Intl` date formatting.

## Learned User Preferences

- Canonical user-facing product title/branding: **L@tr.link** (metadata and primary headings), not abbreviated variants unless requested.
- When following an attached implementation plan in this repo: do not edit the plan artifact; reuse existing todos and update their status rather than creating duplicates.
- Favicon and Apple touch icons should be PNGs with transparency outside the blue squircle; OG/social artwork can remain full-bleed.
- Server-side code in this repo should be **Swift on Hummingbird** (replace TypeScript/Bun services rather than adding parallel runtimes).
- **`LatrKit` is Swift-only** with Apple-style API naming (`SavedLibrary`, `RepositoryClient`, preposition-first methods); web record keys, gateway headers, and upstream DPoP proof pools come from **`latr-packages`** (`latr-packages/record-keys`, `latr-packages/gateway-client`), not duplicated in `apps/web`.
- Prefer **on-protocol storage** for saved metadata, including Open Graph fields on `com.latr.saved.*` records.
- Stygian openness model: three tiers — hosted SaaS, self-hosted reference services, and build-your-own public packages; hybrid repo split (focused foundation repos + grouped product-domain repos until APIs settle).
- Public foundation packages use descriptive names (`ATProtoPrimitiveKit`, `ATProtoAuthKit`, …), not a `Stygian` prefix; app-specific packages (`latr-kit`, `latr-packages`, …) keep product names.
- Shared package dependencies should resolve via git/npm/SwiftPM remotes — not sibling local paths — so CI and contributors run without monorepo-local checkouts.
- Swift gateway CI should treat compiler warnings as errors.

## Learned Workspace Facts

- **the-social-wire**: sibling Turborepo (`../the-social-wire`) — web read-later **mutations** (save/archive/delete) call **latr-gateway HTTP** via `readLaterProvider` (default); list may still read PDS directly. Register `social-wire` client API key + viewer OAuth/DPoP; not a Swift `LatrKit` import in the web app.
- **Extraction repos**: 13 public GitHub repos under `Stygian-Tech` — foundation (`atproto-primitive-kit`, `atproto-auth-kit`, `gateway-trust-kit`, `federation-content-kit`, `mcp-server-kit`, `offline-sync-kit`), L@tr domain (`latr-kit`, `latr-packages`, `latr-reference`), Social Wire domain (`social-wire-appview-kit`, `social-wire-packages`, `social-wire-reference`), meta `reference-deploy`; guide at `reference-deploy/docs/repository-guide.md`. Provision via parent-dir `scripts/provision-github-repos.sh`.
- **Contract parity**: L@tr/read-state deterministic keys must match across Swift, TS, and iOS via golden vectors in **`latr-packages`** (`packages/record-keys/fixtures/stygian-golden-vectors.v1.json`, installed via the root git dependency) — key drift is a hard blocker.
- **Gateway client auth**: registered apps (`latr-web`, `social-wire`, …) send `X-Latr-Client-Id` / `X-Latr-API-Key` on `/v1/latr/*` (enforced when `APP_ENV=prod`); register via `POST /v1/latr/clients/register`. See `docs/architecture/latr-gateway.md`.
- **latr.link** product shape: ATProto read-later — saved data lives as `com.latr.saved.external` / `com.latr.saved.item` on the signed-in user’s PDS with Open Graph metadata stored on-protocol (`latr-packages` lexicons + GitHub **`Stygian-Tech/latr-kit`**). Save/list/state run through `services/latr-gateway` (web is a thin OAuth client); see `docs/architecture/latr-gateway.md`.
- **GitHub Actions CI**: `.github/workflows/ci.yml` on **`origin`** — runs `bash scripts/ci.sh` on pushes/PRs to `main` and `dev`; on push, deploys latr-gateway to Fly when gateway paths change (`scripts/fly-deploy-gateway.sh`, GitHub secret **`FLY_API_TOKEN`**).
- **Hosted testing**: web at **`testing.latr.link`** (Vercel); gateway at **`api.testing.latr.link`** (Fly dev). Set **`NEXT_PUBLIC_LATR_GATEWAY_URL=https://api.testing.latr.link`** on the testing web deployment.
- **Upstream DPoP**: web clients precompute proofs via **`latr-packages/gateway-client`** (`createUpstreamDpopProof`, `createUpstreamDpopProofPool`, `createSaveUpstreamDpopProofPool`); gateway consumes them through **`UpstreamProofPool`** (one proof per PDS XRPC call).
- **Browser extension deploy**: no hosted publish pipeline (unlike web/gateway); test builds bake `VITE_*` env at build time and load unpacked — see `docs/apps/extension.md`.
- **Gateway repo boundary**: `services/latr-gateway` is already a standalone deployable (own Docker/Fly; web/extension call it over HTTP only). Keep it in the product monorepo while save/OG/auth iterate together; extract to `Stygian-Tech/latr-gateway` + `latr-reference` deploy docs when the `/v1/latr/*` API stabilizes.
