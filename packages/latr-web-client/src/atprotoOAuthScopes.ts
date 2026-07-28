import {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  LEGACY_COLLECTION_SAVED_EXTERNAL,
  LEGACY_COLLECTION_SAVED_ITEM,
} from "latr-packages/gateway-client";

function repoScope(
  collection: string,
  actions: readonly ("create" | "update" | "delete")[]
): string {
  const query = actions.map((action) => `action=${action}`).join("&");
  return `repo:${collection}?${query}`;
}

/**
 * Exact repository mutations used by L@tr.link.
 *
 * Public repository reads need no additional permission. Legacy collections are
 * read during one-time migration, but L@tr only needs permission to delete them
 * after copying their records into the current collections.
 */
export const LATR_ATPROTO_OAUTH_SCOPES = [
  "atproto",
  repoScope(COLLECTION_SAVED_EXTERNAL, ["create", "update"]),
  repoScope(COLLECTION_SAVED_ITEM, ["create", "update", "delete"]),
  repoScope(LEGACY_COLLECTION_SAVED_EXTERNAL, ["delete"]),
  repoScope(LEGACY_COLLECTION_SAVED_ITEM, ["delete"]),
] as const;

/** @deprecated Use {@link LATR_ATPROTO_OAUTH_SCOPES} */
export const AT_PROTO_OAUTH_SCOPES = LATR_ATPROTO_OAUTH_SCOPES.join(" ");

/** Space-delimited scope string for client-metadata.json. */
export const LATR_ATPROTO_OAUTH_SCOPE_STRING = AT_PROTO_OAUTH_SCOPES;
