# Railway deployment and cutover

Railway hosts L@tr.link in one project with isolated `dev` and `production`
environments. GitHub Actions verifies code; Railway's GitHub integration deploys
the linked branch after its own successful build.

| Environment | Branch | Web | Gateway | Developer console |
| --- | --- | --- | --- | --- |
| Development | `dev` | `testing.latr.link` | `api.testing.latr.link` | `testing.latrkit.dev` |
| Production | `main` | `latr.link` | `api.latr.link` | `latrkit.dev` |

Each environment contains `Web`, `Gateway`, `LatrKit Developer Console`, and an
environment-local managed `Postgres` service. Config-as-code lives in
`railway/*.json`; service root directories stay at `/`.

## Required variables

Gateway:

- `APP_ENV=dev|prod`
- `PORT=8080`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `OAUTH_PUBLIC_ORIGIN` set to the environment Web origin
- `OAUTH_LATRKIT_PUBLIC_ORIGIN` set to the environment console origin
- `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY=true` in Production

Web:

- `APP_ENV` and `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_LATR_GATEWAY_URL` set to the public environment Gateway origin
- `LATR_GATEWAY_INTERNAL_URL=http://${{Gateway.RAILWAY_PRIVATE_DOMAIN}}:8080`
- server-only `LATR_GATEWAY_CLIENT_ID` + `LATR_GATEWAY_API_KEY`

Developer Console:

- `APP_ENV` and `NEXT_PUBLIC_APP_ENV`
- `NEXT_PUBLIC_LATR_GATEWAY_URL` set to the public environment Gateway origin

Do not put gateway API keys in `NEXT_PUBLIC_*` variables.

## Database migrations

`/railway/gateway.json` runs `/usr/local/bin/apply-database-migrations` as a
pre-deploy command. The runner creates `schema_migrations`, applies each
`services/latr-gateway/migrations/*.sql` file once in a transaction, and aborts
the deployment on SQL errors. GitHub Actions never receives a hosted database
URL.

Validate a disposable or tunneled database locally with:

```bash
DATABASE_URL='postgresql://…' bash scripts/apply-database-migrations.sh
DATABASE_URL='postgresql://…' bash scripts/apply-database-migrations.sh
```

The second run must report every migration as `skip`.

## Data migration verification

The gateway database contains developer clients, hashed API keys, and usage
counters. Saved L@tr items and Open Graph metadata live on each user's PDS and
are not copied between hosting providers.

For each environment:

1. Create the Railway Postgres service and apply migrations.
2. Export `developer_clients`, `developer_api_keys`, and
   `developer_usage_daily` with a `pg_dump` version at least as new as the source.
3. Restore into empty Railway tables with `ON_ERROR_STOP=1`.
4. Compare all three source/destination row counts.
5. Confirm every `developer_api_keys.client_id` resolves to a
   `developer_clients.client_id` and verify the migration ledger.
6. Retain the source database and provider deployment as rollback until the
   environment has passed OAuth, key issuance, save/list/archive/delete, and
   restart-persistence checks.

## DNS sequence

Register Railway custom domains first. Add Railway's `_railway-verify` TXT
records while the existing CNAME/A records still serve the old provider. Wait
for ownership verification, then update only the traffic records. Railway may
not begin certificate issuance until its CNAME is serving; monitor HTTPS during
that short window and restore the captured records if issuance fails.
For nested `api.testing.latr.link`, use DNS-only mode unless the Cloudflare zone
has certificate coverage for nested subdomains.

## Production cutover and rollback

Production moved to Railway on August 3, 2026 after Development passed the full
test plan. `latr.link`, `api.latr.link`, and `latrkit.dev` now route to the
Railway `production` environment from `main`. The legacy Vercel projects are
disconnected from GitHub and the Fly Gateway is stopped with autostart disabled;
both providers and the source Supabase database remain intact as rollback
targets through the rollback window.

The final frozen database export had SHA-256
`f7842195bbb2ab821475b3befff794b95b01e95ac5e1c2913e054a561f7fec5c`.
The restore preserved 2 developer clients, 3 API keys, and 121 daily usage rows
with no orphaned records. Cutover added one Railway-only Web API key, so the
post-cutover key count is 4. The raw key exists only in Railway; the database
stores its SHA-256 hash. Exact pre-cutover Cloudflare zone exports are retained
in the operator recovery directory for DNS rollback.

The production procedure is:

1. Snapshot and count the source tables; verify the dump checksum.
2. Stop the old Fly Gateway to freeze client/key/usage writes.
3. Take a final data-only snapshot after the freeze and restore it into the
   migrated Railway Production database.
4. Re-run count, foreign-key, and migration-ledger checks.
5. Deploy Railway Production from `main`, verify generated Railway domains, and
   confirm credentials through an authenticated probe.
6. Switch `api.latr.link`, `latr.link`, and `latrkit.dev` traffic records only
   after Railway ownership/TLS is active.
7. Verify health, OAuth metadata, sign-in, list/save/archive/delete, API-key
   creation, and database persistence across a Gateway restart.
8. Keep Fly, Vercel, the source database, and the final dump intact through the
   rollback window. Roll back by restoring the old DNS records and restarting
   Fly; do not delete source data during cutover.
