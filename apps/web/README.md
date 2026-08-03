# L@tr.link web

Next.js web client for L@tr.link. Run it from the monorepo root:

```bash
bun install
bun --cwd apps/web dev
```

Open `http://127.0.0.1:3000` for loopback ATProto OAuth. Environment variables
and local OAuth behavior are documented in [`.env.example`](.env.example).

## Railway

Railway builds this workspace from `/railway/web.json`.

| Environment | Origin | `NEXT_PUBLIC_APP_ENV` | Gateway |
| --- | --- | --- | --- |
| Development | `https://testing.latr.link` | `dev` | `https://api.testing.latr.link` |
| Production | `https://latr.link` | `prod` | `https://api.latr.link` |

The browser uses the same-origin `/api/latr-gateway/*` proxy. On Railway, set
`LATR_GATEWAY_INTERNAL_URL=http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:8080` so
the proxy-to-gateway hop stays private. Set `LATR_GATEWAY_CLIENT_ID` and
`LATR_GATEWAY_API_KEY` as server-only variables; never expose them through
`NEXT_PUBLIC_*`.

See [the Railway runbook](../../docs/deployment/railway.md) for migrations,
DNS, verification, and production cutover.
