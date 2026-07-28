# L@tr architecture

## Components

- **Web (`apps/web`)** — Next.js App Router, ATProto OAuth in the browser, thin client to the L@tr gateway for save/list/state workflows.
- **Gateway (`services/latr-gateway`)** — Swift/Hummingbird HTTP service: OAuth/DPoP gate, PDS write-through, server-side Open Graph fetch, Standard.site AT URI discovery.
- **`Stygian-Tech/latr-kit`** (GitHub) — Swift **`LatrKit`** library (`SavedLibrary`, `RepositoryClient`, `URLNormalizer`, …). SwiftPM git dependency from `services/latr-gateway`.
- **`Stygian-Tech/latr-packages`** (GitHub) — TS contracts (`gateway-client`, `record-keys`, lexicons). Root git dependency; not duplicated under `packages/`.
- **`packages/latr-web-client`** — Monorepo-only shared save/gateway client for web + extension (no separate org repo).

```mermaid
flowchart LR
  Browser[L@tr_web]
  Gateway[L@tr_gateway]
  PDS[User_PDS]
  AppView[Bluesky_AppView]
  Browser -->|"OAuth_DPoP"| Gateway
  Gateway -->|"com.atproto.repo.*"| PDS
  Browser -->|"public_reads"| AppView
  Browser -->|"read_only_getRecord"| PDS
```

## Data ownership

| Data | Location |
|------|----------|
| Saved items | `link.latr.saved.item` on the user’s repo |
| External URL wrappers | `link.latr.saved.external` on the user’s repo |
| Session tokens | OAuth client browser storage (IndexedDB / memory) |
| Optional UI cache | Browser `localStorage` / memory (React Query persistence) |

Save, list, archive, and unsave run through the L@tr gateway. The web app no longer performs direct L@tr `com.atproto.repo.*` writes.

## Flows (summary)

1. **Save external URL** — Web POSTs to gateway → normalize URL → upsert `link.latr.saved.external` → upsert `link.latr.saved.item` → server OG enrichment.
2. **Save ATProto record** — Web POSTs subject URI (+ optional linked web URL) → gateway upserts `link.latr.saved.item` with preview metadata when OG is available.
3. **List** — Gateway lists `link.latr.saved.item`; web resolves each `subjectUri` for display (App View + read-only repo get).
4. **Unsave / archive** — Gateway PATCH/DELETE on saved-item records.

## OAuth scopes

Repository writes use action-limited `repo:` scopes aligned across the shared web client, hosted metadata, and Swift gateway metadata:

- `link.latr.saved.external`: create and update wrapper metadata.
- `link.latr.saved.item`: create, update, and delete saved queue entries.
- Legacy `com.latr.saved.*`: delete only, after the one-time copy into current collections.

Public repository reads require no additional permission. L@tr.link does not request profile, post, blob, message, email, or account-management access. Users must re-auth after scope changes.

See [latr-gateway.md](./latr-gateway.md) for route contracts, deployment, and auth constraints.
