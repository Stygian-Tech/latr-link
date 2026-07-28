# L@tr.link browser extension

Save the active tab to your L@tr read-later library through the same Swift gateway and ATProto OAuth path as the web app.

## Workspace

| Path | Role |
|------|------|
| [`apps/extension`](../../apps/extension) | Chromium, Firefox, and Safari Web Extension (WXT) |
| [`packages/latr-web-client`](../../packages/latr-web-client) | Shared save resolver, gateway client, and `LatrRepo` |
| `GET /oauth/extension-client-metadata.json` on the gateway | Public hosted-test OAuth client metadata |

## Prerequisites

1. **Gateway** — hosted testing uses `https://api.testing.latr.link`.
2. **Gateway client** — register `latr-link-extension-testing` in [latrkit.dev](https://latrkit.dev) and issue an API key. The extension sends the split `X-Latr-Client-Id` and `X-Latr-API-Key` headers.

For a local gateway, the equivalent registration request is:

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/latr/clients/register \
  -H "Content-Type: application/json" \
  -d '{"clientId":"latr-link-extension-testing","displayName":"L@tr.link Extension Testing"}'
```

3. **OAuth client metadata** — the gateway serves environment-specific metadata. For hosted testing, verify `https://api.testing.latr.link/oauth/extension-client-metadata.json` lists `https://testing.latr.link/extension/callback`.

### Redirect URI

ATProto redirects to the hosted HTTPS callback. The background listener validates the exact configured origin/path and OAuth parameters, then replaces that tab with the extension-owned `callback.html`. OAuth state and sessions therefore remain in the extension origin in both browsers.

## Local development

```bash
cp apps/extension/.env.example apps/extension/.env.local
# Set VITE_LATR_GATEWAY_API_KEY to the issued testing key.

bun install
bun --cwd apps/extension run dev          # Chromium (default)
bun --cwd apps/extension run dev:firefox
```

Load the unpacked build shown by WXT:

- Chrome: `apps/extension/.output/chrome-mv3` from `chrome://extensions` with Developer mode enabled.
- Firefox: load `apps/extension/.output/firefox-mv2/manifest.json` temporarily from `about:debugging#/runtime/this-firefox`.

Firefox uses the stable add-on ID `latr-link@stygian.tech`, requires Firefox 140+, and declares required transmission of authentication information and browsing activity. The latter covers URLs explicitly saved to the user’s L@tr.link library.

## Builds

```bash
bun --cwd apps/extension run build:chromium
bun --cwd apps/extension run build:firefox
bun --cwd apps/extension run build:safari   # macOS + Xcode for distribution
```

Zip artifacts for store upload:

```bash
bun --cwd apps/extension run zip:chromium
bun --cwd apps/extension run zip:firefox
```

## Environment variables

See [`apps/extension/.env.example`](../../apps/extension/.env.example).

| Variable | Description |
|----------|-------------|
| `VITE_LATR_GATEWAY_URL` | Gateway base URL |
| `VITE_LATR_APP_ENV` | `local`, `dev`, or `prod` |
| `VITE_LATR_GATEWAY_CLIENT_ID` | Registered gateway client ID |
| `VITE_LATR_GATEWAY_API_KEY` | Issued gateway API key; do not commit it |
| `VITE_ATPROTO_CLIENT_ID` | Public OAuth metadata URL |
| `VITE_ATPROTO_REDIRECT_URI` | Hosted HTTPS callback listed by the metadata document |
| `VITE_LATR_WEB_URL` | Web app for “Open library” |

## Smoke test

1. Sign in with a Bluesky handle from the popup.
2. Open a normal HTTPS article tab → **Save current tab**.
3. Confirm the item appears at `/library` on the web app (same account).
4. Save a `bsky.app` post URL → should save as AT subject when resolvable.
5. Sign out from the popup.
6. Repeat saves through the context menu and `Ctrl+Shift+L` / `Command+Shift+L`; these queue the URL and auto-save through the popup.

## CI

`scripts/ci.sh` runs `turbo … --filter=extension...` for typecheck, test, and build (Chromium).
