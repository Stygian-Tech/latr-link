# L@tr.link browser extension

Save the active tab to your L@tr read-later library through the same Swift gateway and ATProto OAuth path as the web app.

## Workspace

| Path | Role |
|------|------|
| [`apps/extension`](../../apps/extension) | Chromium, Firefox, and Safari Web Extension (WXT) |
| [`packages/latr-web-client`](../../packages/latr-web-client) | Shared save resolver, gateway client, and `LatrRepo` |
| [`apps/web/public/extension/client-metadata.json`](../../apps/web/public/extension/client-metadata.json) | Hosted OAuth client metadata |

## Prerequisites

1. **Gateway** — local: `cd services/latr-gateway && swift run LatrGateway` (`http://127.0.0.1:8080`).
2. **Gateway client** — register `latr-extension` (or your chosen id):

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/latr/clients/register \
  -H "Content-Type: application/json" \
  -d '{"clientId":"latr-extension","displayName":"L@tr.link Extension"}'
```

3. **OAuth client metadata** — add the extension redirect URI to [`client-metadata.json`](../../apps/web/public/extension/client-metadata.json) `redirect_uris`, then register the extension as a gateway client in the developer console and use its `X-Latr-Client-Id` + `X-Latr-API-Key` headers.

### Redirect URI

After loading the unpacked extension once, read the redirect URI:

- **Chromium:** `chrome.identity.getRedirectURL('callback.html')` → `https://<extension-id>.chromiumapp.org/callback.html`
- **Firefox / Safari:** `browser.runtime.getURL('/callback.html')` → `moz-extension://…/callback.html` or Safari equivalent

Append that exact URI to `redirect_uris` in hosted metadata before users can sign in.

## Local development

```bash
cp apps/extension/.env.example apps/extension/.env.local
# Set VITE_LATR_GATEWAY_CLIENT_CREDENTIAL (base64; match gateway official env or registration response)

bun install
bun --cwd apps/extension run dev          # Chromium (default)
bun --cwd apps/extension run dev:firefox
```

Load the unpacked build from `apps/extension/.output/chrome-mv3` (path shown by WXT) in your browser’s extension manager.

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
| `VITE_LATR_GATEWAY_CLIENT_CREDENTIAL` | Base64 official client credential |
| `VITE_ATPROTO_CLIENT_ID` | OAuth metadata URL (default `https://latr.link/extension/client-metadata.json`) |
| `VITE_LATR_WEB_URL` | Web app for “Open library” |

## Smoke test

1. Sign in with a Bluesky handle from the popup.
2. Open a normal HTTPS article tab → **Save current tab**.
3. Confirm the item appears at `/library` on the web app (same account).
4. Save a `bsky.app` post URL → should save as AT subject when resolvable.
5. Sign out from the popup.

## CI

`scripts/ci.sh` runs `turbo … --filter=extension...` for typecheck, test, and build (Chromium).
