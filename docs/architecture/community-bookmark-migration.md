# Community bookmark migration (LTR-13)

`community.lexicon.bookmarks.bookmark` is the authoritative saved-bookmark record. Its TID record key is shared by the user-owned `link.latr.bookmarks.metadata` sidecar. The community record contains only `subject`, `createdAt`, and optional `tags`; archive state, note, last-opened time, and temporary migration provenance belong in the sidecar. Unknown fields are preserved on every read-modify-write.

The gateway exposes `link.latr.bookmarks.listBookmarks`, `listTags`, `getBookmark`, `saveBookmark`, `syncMetadata`, `setState`, `setTags`, `renameTag`, `deleteTag`, `deleteBookmark`, and `migrateLegacy` under `/xrpc/<NSID>`. Views return the community record plus optional `metadataRecord` and service-derived `preview`. Preview data is cached by exact subject with no DID association; Postgres is used when `DATABASE_URL` is configured and an in-memory cache is used locally.

Bookmark tags follow the community Lexicon contract. Authored boundaries are trimmed, empty tags are rejected, case and internal whitespace are preserved, and exact duplicates collapse while retaining first-seen order. A bookmark may contain at most 100 tags; each tag is limited to 64 graphemes and 640 UTF-8 bytes. `listBookmarks?tag=` applies an exact tag match to the current bounded bookmark page, so an empty filtered page can still return a cursor. `listTags` reports exact tag counts for one page of at most 100 scanned bookmarks; clients merge counts while following its cursor.

`setTags` replaces a bookmark's complete tag array with a CID-guarded write. `renameTag` and `deleteTag` scan no more than 25 bookmarks per request and return `{ ok, scanned, matched, updated, cursor? }`. Callers must resume until `cursor` is absent. The opaque cursor includes a verification phase, so completion confirms that no source-tag records remain; a conflict is reported without hiding partial progress from earlier calls.

`syncMetadata` is an explicit, idempotent procedure for community bookmarks created by other clients. It scans one bounded bookmark page, creates missing same-rkey metadata sidecars with the exact bookmark URI and subject and an initial unread state, preserves matching metadata, and leaves mismatched sidecars untouched. L@tr clients invoke it best-effort before each list page; a temporary reconciliation failure never hides the underlying community bookmark.

Migration scans both `com.latr.saved.*` and `link.latr.saved.*`. Wrapper records retain their original encountered HTTP(S) URL (falling back to `normalizedUrl`), while native records use a valid `linkedWebUrl` or retain their AT URI. Duplicate groups select the oldest community bookmark, union tags deterministically, and preserve state, note, and latest `lastOpenedAt`. Conflicting notes or unknown legacy fields leave the complete group untouched. Target writes and source-CID deletes use one `com.atproto.repo.applyWrites` transaction and are safe to retry with the returned subject cursor.

The `/v1/latr/*` save/list/state/delete routes are one-release adapters. They emit deprecation and successor headers and never create legacy records. Keep legacy delete OAuth scopes only until L@tr clients and TSW-48 have shipped XRPC.

## Development rollout

1. Publish and pin immutable `latr-packages` and `latr-kit` revisions.
2. Deploy the gateway and web app to Railway development only.
3. Reauthenticate a test account for community-bookmark and metadata write scopes.
4. Migrate representative wrapper, native-web, and direct-AT records twice.
5. Exercise tag listing beyond 100 records and rename/delete beyond 25 records, resuming every cursor through verification; inject one CID conflict and retry from the last successful cursor.
6. Compare PDS community/metadata records with the rendered library; verify the second migration run is a no-op and no legacy records are created.
7. Soak development before requesting separate production approval. Production migration and REST removal are not part of this rollout.
