import { LATR_REPO_OAUTH_SCOPES } from "latr-packages/gateway-client";

/** OAuth scopes for L@tr repo collections (current + legacy cleanup). */
export const LATR_ATPROTO_OAUTH_SCOPES = ["atproto", ...LATR_REPO_OAUTH_SCOPES] as const;

/** @deprecated Use {@link LATR_ATPROTO_OAUTH_SCOPES} */
export const AT_PROTO_OAUTH_SCOPES = LATR_ATPROTO_OAUTH_SCOPES.join(" ");

/** Space-delimited scope string for client-metadata.json. */
export const LATR_ATPROTO_OAUTH_SCOPE_STRING = AT_PROTO_OAUTH_SCOPES;
