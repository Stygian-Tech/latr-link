# Railway deployment configuration

Railway is the canonical deployment platform for Development and Production.
GitHub Actions validates source changes; Railway deploys linked revisions through
its GitHub integration.

Each service keeps the monorepo root directory at `/` and selects its exact
config-as-code file:

| Railway service | Config file | Port |
| --- | --- | --- |
| Web | `/railway/web.json` | Railway-injected `PORT` |
| LatrKit Developer Console | `/railway/latrkit-dev.json` | Railway-injected `PORT` |
| Gateway | `/railway/gateway.json` | `8080` |

Development tracks the `dev` branch; Production tracks `main`. The managed
Postgres service is environment-isolated and does not need repository config.
The gateway applies `services/latr-gateway/migrations/*.sql` in a Railway
pre-deploy command and records each version in `schema_migrations`.

The Web service reaches Gateway privately with
`LATR_GATEWAY_INTERNAL_URL=http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:8080`.
Browsers and the Developer Console use the environment's public Gateway custom
domain because Railway private DNS is not browser-accessible.
