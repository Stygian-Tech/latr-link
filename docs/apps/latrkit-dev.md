# LatrKit developer console (`latrkit.dev`)

The developer portal lives at **`apps/latrkit-dev`** in this monorepo. The former
standalone repository is retained as migration history but is no longer the
deployment source.

Sign in with ATProto OAuth, register gateway clients, issue split-header API keys (`X-Latr-Client-Id` + `X-Latr-API-Key`), and review usage counters. The Swift gateway in this monorepo (`services/latr-gateway`) implements the management APIs.

## Local development

```bash
# Gateway (this monorepo)
cd services/latr-gateway && swift run LatrGateway

# Console (this monorepo)
cd apps/latrkit-dev && bun run dev   # http://127.0.0.1:3001
```

## Gateway configuration

| Variable | Description |
|----------|-------------|
| `LATR_GATEWAY_DEVELOPER_STORE_PATH` | JSON persistence for clients/keys/usage |
| `DATABASE_URL` | Railway Postgres; Gateway applies the migration history before deployment |

See [`docs/architecture/latr-gateway.md`](../architecture/latr-gateway.md), the
[Railway runbook](../deployment/railway.md), and
[`apps/latrkit-dev/README.md`](../../apps/latrkit-dev/README.md).
