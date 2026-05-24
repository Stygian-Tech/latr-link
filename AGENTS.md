## Workspace facts

- **Git remotes — origin is Tangled, vercel is GitHub.** This repo tracks Tangled on **`origin`** (`git@tangled.org:did:plc:jq2bt674bkbf6n53zxzmlixv`) and GitHub on **`vercel`** (`github.com/Stygian-Tech/latr-link`). After a commit that should appear on both forges: `git push origin <branch> && git push vercel <branch>` (replace `<branch>` with the active branch).
- Monorepo root: Bun workspaces (`apps/*`, `packages/*`, `services/*`) + Turborepo.
- Web app: `apps/web` (package name `web`). Run checks with `bash scripts/ci.sh` or `bun run turbo run build --filter=web...`.
- Gateway: `services/latr-gateway` — Swift/Hummingbird HTTP service: OAuth/DPoP gate, PDS write-through for L@tr saves. Local: `cd services/latr-gateway && swift run LatrGateway` (port 8080). Web uses `NEXT_PUBLIC_LATR_GATEWAY_URL`.
- Shared logic: `packages/latr-kit` (import as `latr-kit` in `apps/web`; record orchestration lives in the Swift gateway).

## Conventions

- ATProto OAuth scopes must match `apps/web/public/client-metadata.json` — users must re-auth after scope changes.
- Local dev: loopback OAuth activates on **localhost / 127.0.0.1** without requiring `NODE_ENV=development` (works with `next start` too). Optional `NEXT_PUBLIC_APP_ENV=local` in `apps/web/.env.local`. Timeouts: `NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS`, `NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS` — see `apps/web/.env.example`. Auth UI also forces loading off after 4s (`useAuth` failsafe). Use `http://127.0.0.1:3000` when testing OAuth.
- **Hosted / prod:** **`NEXT_PUBLIC_APP_ENV=prod`** must be set in Vercel (or any host): in the client bundle, a missing **`NEXT_PUBLIC_APP_ENV`** reads as **`local`** (`environmentBanner.ts`), so the public site inherits LOCAL ribbons and other dev cues. Full value list lives in **`apps/web/.env.example`**.

## Learned User Preferences

- Canonical user-facing product title/branding: **L@tr.link** (metadata and primary headings), not abbreviated variants unless requested.
- When following an attached implementation plan in this repo: do not edit the plan artifact; reuse existing todos and update their status rather than creating duplicates.
- Favicon and Apple touch icons should be PNGs with transparency outside the blue squircle; OG/social artwork can remain full-bleed.

## Learned Workspace Facts

- **the-social-wire**: sibling Turborepo under the same parent as this repo (`../the-social-wire`) — reference for monorepo layout, Next/App Router patterns, and ATProto client habits when aligning tooling.
- **latr.link** product shape: ATProto read-later — saved data lives as `com.latr.saved.external` / `com.latr.saved.item` on the signed-in user’s PDS (`packages/latr-kit`, `packages/lexicons`). Save/list/state run through `services/latr-gateway`; see `docs/architecture/latr-gateway.md`.
