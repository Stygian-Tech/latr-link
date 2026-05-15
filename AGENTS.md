## Workspace facts

- **Git push — use both remotes.** This repo tracks code on **`origin`** (`git@tangled.org:…`) and mirrors to **`vercel`** (`github.com/CountableNewt/latr-link`) so Vercel’s Git-linked project deploys from GitHub. After a commit: `git push origin <branch> && git push vercel <branch>` (replace `<branch>` with the active branch).
- Monorepo root: Bun workspaces (`apps/*`, `packages/*`) + Turborepo.
- Web app: `apps/web` (package name `web`). Run checks with `bun run turbo run build --filter=web...` or `cd apps/web && bun run …`.
- Shared logic: `packages/latr-kit` (import as `latr-kit` in `apps/web`).

## Conventions

- ATProto OAuth scopes must match `apps/web/public/client-metadata.json` — users must re-auth after scope changes.
- Local dev: loopback OAuth activates on **localhost / 127.0.0.1** without requiring `NODE_ENV=development` (works with `next start` too). Optional `NEXT_PUBLIC_APP_ENV=local` in `apps/web/.env.local`. Timeouts: `NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS`, `NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS` — see `apps/web/.env.example`. Auth UI also forces loading off after 4s (`useAuth` failsafe). Use `http://127.0.0.1:3000` when testing OAuth.
- **Hosted / prod:** **`NEXT_PUBLIC_APP_ENV=prod`** must be set in Vercel (or any host): in the client bundle, a missing **`NEXT_PUBLIC_APP_ENV`** reads as **`local`** (`environmentBanner.ts`), so the public site inherits LOCAL ribbons and other dev cues. Full value list lives in **`apps/web/.env.example`**.

## Learned User Preferences

- Canonical user-facing product title/branding: **L@tr.link** (metadata and primary headings), not abbreviated variants unless requested.
- When following an attached implementation plan in this repo: do not edit the plan artifact; reuse existing todos and update their status rather than creating duplicates.

## Learned Workspace Facts

- **the-social-wire**: sibling Turborepo under the same parent as this repo (`../the-social-wire`) — reference for monorepo layout, Next/App Router patterns, and ATProto client habits when aligning tooling.
- **latr.link** product shape: backendless ATProto read-later — saved data lives as `com.latr.saved.external` / `com.latr.saved.item` on the signed-in user’s PDS (`packages/latr-kit`, `packages/lexicons`).
