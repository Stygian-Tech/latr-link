# LatrKit developer console (`latrkit.dev`)

The developer portal lives in its own repository: **[github.com/Stygian-Tech/latrkit-dev](https://github.com/Stygian-Tech/latrkit-dev)**.

Sign in with ATProto OAuth, register gateway clients, issue split-header API keys (`X-Latr-Client-Id` + `X-Latr-API-Key`), and review usage counters. The Swift gateway in this monorepo (`services/latr-gateway`) implements the management APIs.

## Local development (two repos)

```bash
# Gateway (this monorepo)
cd services/latr-gateway && swift run LatrGateway

# Console (sibling checkout)
cd ../latrkit-dev && bun run dev   # http://127.0.0.1:3001
```

## Gateway configuration

| Variable | Description |
|----------|-------------|
| `LATR_GATEWAY_DEVELOPER_STORE_PATH` | JSON persistence for clients/keys/usage |
| `DATABASE_URL` | Supabase Postgres — apply `migrations/001_developer_console.sql` (schema only today) |

See [`docs/architecture/latr-gateway.md`](../architecture/latr-gateway.md) and the [latrkit-dev README](https://github.com/Stygian-Tech/latrkit-dev/blob/main/README.md).
