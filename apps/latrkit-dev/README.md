# LatrKit Developer Console

Developer portal for [LatrKit](https://github.com/Stygian-Tech/latr-kit) gateway API keys — hosted at **latrkit.dev**.

Sign in with your ATProto account, register developer clients, issue `X-Latr-Client-Id` + `X-Latr-API-Key` credentials, and review usage counters. Billing (Stripe) is planned; usage limits run in developer preview until then.

## Related repositories

| Repo | Role |
|------|------|
| [Stygian-Tech/latr-link](https://github.com/Stygian-Tech/latr-link) | Product monorepo (gateway service, L@tr.link web) |
| [Stygian-Tech/latr-packages](https://github.com/Stygian-Tech/latr-packages) | Shared TS contracts (`gateway-client`, record keys) |
| [Stygian-Tech/latr-kit](https://github.com/Stygian-Tech/latr-kit) | Swift domain library |

## Local development

```bash
bun install
cp .env.example .env.local

# Terminal 1 — latr-gateway (from the monorepo root)
cd services/latr-gateway && swift run LatrGateway

# Terminal 2 — console
bun run dev
```

Open `http://127.0.0.1:3001`, sign in with a Bluesky handle, and create clients against `http://127.0.0.1:8080` (default gateway URL).

## Environment

See [`.env.example`](.env.example).

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_LATR_GATEWAY_URL` | LatrKit gateway base URL |
| `NEXT_PUBLIC_ATPROTO_CLIENT_ID` | Hosted OAuth metadata URL (production: `https://latrkit.dev/client-metadata.json`) |

Developer management calls use OAuth + DPoP and do not put an application API
key in browser code.

## Deploy

Railway builds this workspace from `/railway/latrkit-dev.json`. Development uses
`testing.latrkit.dev` with `NEXT_PUBLIC_APP_ENV=dev` and
`NEXT_PUBLIC_LATR_GATEWAY_URL=https://api.testing.latr.link`; Production uses
`latrkit.dev`, `NEXT_PUBLIC_APP_ENV=prod`, and `https://api.latr.link`.
