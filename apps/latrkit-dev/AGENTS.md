# LatrKit Developer Console

Next.js app for **latrkit.dev** — ATProto OAuth login, developer client/API key management via `services/latr-gateway` HTTP APIs in the [latr-link](https://github.com/Stygian-Tech/latr-link) monorepo.

## Stack

- Next.js 16 App Router, React 19, Tailwind CSS v4
- `@atproto/oauth-client-browser` (loopback on `127.0.0.1`; hosted metadata on latrkit.dev; gateway metadata on deployment-protected staging e.g. `testing.latrkit.dev`)
- `latr-packages` git dependency for shared gateway types/constants

## Conventions

- Management API calls use OAuth + DPoP only (no app API key in the browser).
- Gateway URL: `NEXT_PUBLIC_LATR_GATEWAY_URL` + hostname heuristics in `src/lib/gatewayConfig.ts`.
- First-party apps register through the same client + API key flow as any other developer.

## Commands

```bash
bun install
bun run dev      # http://127.0.0.1:3001
bun run typecheck
bun run lint
bun run build
```

Pin Bun **1.3.14** (`packageManager` in `package.json`).

## Learned User Preferences

- OAuth architecture should match latr.link: browser tokens (PKCE + IndexedDB), with gateway-hosted client metadata when the SPA is deployment-protected — not cookie-based server sessions.
- This app is part of the `latr-link` Bun/Turbo monorepo and deploys from the
  matching Railway service; CI runs on `dev` and `main`.

## Learned Workspace Facts

- Staging domain is `testing.latrkit.dev` (not legacy `testing.stygiantech.dev`).
- Staging OAuth uses gateway metadata at `https://api.testing.latr.link/oauth/latrkit-client-metadata.json`; latr-gateway needs `OAUTH_LATRKIT_PUBLIC_ORIGIN=https://testing.latrkit.dev`.
- Unprotected hosts (e.g. `latrkit.dev`) serve same-origin `/client-metadata.json`; gateway metadata `client_uri` must match the gateway origin — only `redirect_uris` point at the SPA.
- Loopback OAuth activates only on `127.0.0.1`/`localhost` (or `NEXT_PUBLIC_ATPROTO_LOCAL=true`); `NEXT_PUBLIC_APP_ENV=local` does not force loopback on hosted deploys.
- `testing.latrkit.dev` maps to the testing gateway (`api.testing.latr.link`) via hostname heuristics in `src/lib/gatewayConfig.ts`.
- Next.js 16 uses Turbopack by default and resolves the monorepo root lockfile.
- Unset `NEXT_PUBLIC_ATPROTO_CLIENT_ID` on staging unless metadata is on the same origin you browse; origin mismatches cause Bluesky PAR 400s.
