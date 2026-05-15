# L@tr — ATProto lexicons

Schemas for read-later data stored on the user’s PDS.

| Lexicon | Role |
|---------|------|
| `com.latr.saved.external` | Wrapper for an external URL (deterministic rkey per normalized URL) |
| `com.latr.saved.item` | Saved edge: points at an AT URI (wrapper or native record); optional `linkedWebUrl` + `preview*` cache OG metadata for native subjects |

Record keys are **application-chosen** (deterministic hashes), so lexicons declare `"key": "any"`.

See the product spec in Notion: **L@tr — Lexicons + Web Client (No Backend) + Social Wire Integration**.
