import {
  LATR_BOOKMARK_REPO_OAUTH_SCOPES,
  LATR_MIGRATION_CLEANUP_REPO_OAUTH_SCOPES,
  LATR_READING_STATE_OAUTH_SCOPE,
  LATR_REPO_OAUTH_SCOPES,
} from "latr-packages/gateway-client";

/**
 * Exact OAuth permissions used by L@tr.link.
 *
 * Public repository reads need no additional permission. Legacy collections are
 * read during one-time migration, but L@tr only needs permission to delete them
 * after copying their records into the current collections.
 */
export {
  LATR_BOOKMARK_REPO_OAUTH_SCOPES,
  LATR_MIGRATION_CLEANUP_REPO_OAUTH_SCOPES,
} from "latr-packages/gateway-client";

/** Compatibility name for the canonical latr-packages reading-state scope. */
export const LATR_READING_STATE_PERMISSION_SCOPE = LATR_READING_STATE_OAUTH_SCOPE;

export const LATR_ATPROTO_OAUTH_SCOPES = [
  "atproto",
  ...LATR_REPO_OAUTH_SCOPES,
] as const;

/** @deprecated Use {@link LATR_ATPROTO_OAUTH_SCOPES} */
export const AT_PROTO_OAUTH_SCOPES = LATR_ATPROTO_OAUTH_SCOPES.join(" ");

/** Space-delimited scope string for client-metadata.json. */
export const LATR_ATPROTO_OAUTH_SCOPE_STRING = AT_PROTO_OAUTH_SCOPES;
