import { AT_PROTO_OAUTH_SCOPES as LATR_AT_PROTO_OAUTH_SCOPES } from "latr-web-client/atprotoOAuthScopes";

import {
  USER_INPUT_BLOB_OAUTH_SCOPE,
  USER_INPUT_OAUTH_SCOPE,
} from "@/lib/userInputFeedback";

/**
 * Web-only OAuth scopes. The extension keeps the narrower shared L@tr scope
 * because it does not expose the User Input feedback form.
 *
 * Existing web sessions must sign out and back in after this scope expands.
 */
export const AT_PROTO_OAUTH_SCOPES = [
  LATR_AT_PROTO_OAUTH_SCOPES,
  USER_INPUT_OAUTH_SCOPE,
  USER_INPUT_BLOB_OAUTH_SCOPE,
].join(" ");
