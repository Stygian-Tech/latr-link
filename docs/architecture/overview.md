# L@tr architecture

## Components

- **Web (`apps/web`)** — Next.js App Router, ATProto OAuth in the browser, thin client to the L@tr gateway for save/list/state workflows.
- **Gateway (`services/latr-gateway`)** — Swift/Hummingbird HTTP service: OAuth/DPoP gate, PDS write-through, server-side Open Graph fetch, Standard.site AT URI discovery.
- **`packages/latr-kit`** — URL normalization, deterministic record keys (`rkey`), shared TypeScript types for the web client. Server-side record workflows run in the Swift gateway.
- **`packages/lexicons`** — Lexicon JSON for `com.latr.saved.external` and `com.latr.saved.item`.

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
| Saved items | `com.latr.saved.item` on the user’s repo |
| External URL wrappers | `com.latr.saved.external` on the user’s repo |
| Session tokens | OAuth client browser storage (IndexedDB / memory) |
| Optional UI cache | Browser `localStorage` / memory (React Query persistence) |

Save, list, archive, and unsave run through the L@tr gateway. The web app no longer performs direct L@tr `com.atproto.repo.*` writes.

## Flows (summary)

1. **Save external URL** — Web POSTs to gateway → normalize URL → upsert `com.latr.saved.external` → upsert `com.latr.saved.item` → server OG enrichment.
2. **Save ATProto record** — Web POSTs subject URI (+ optional linked web URL) → gateway upserts `com.latr.saved.item` with preview metadata when OG is available.
3. **List** — Gateway lists `com.latr.saved.item`; web resolves each `subjectUri` for display (App View + read-only repo get).
4. **Unsave / archive** — Gateway PATCH/DELETE on saved-item records.

## OAuth scopes

Repository writes require explicit `repo:` scopes for both collections, aligned with `apps/web/public/client-metadata.json`. Users must re-auth after scope changes.

See [latr-gateway.md](./latr-gateway.md) for route contracts, deployment, and auth constraints.
