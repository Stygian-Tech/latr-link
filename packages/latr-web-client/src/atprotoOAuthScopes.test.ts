import { describe, expect, test } from "bun:test";

import { LATR_ATPROTO_OAUTH_SCOPES } from "./atprotoOAuthScopes";

describe("LATR_ATPROTO_OAUTH_SCOPES", () => {
  test("requests only the repository mutations used by L@tr", () => {
    expect(LATR_ATPROTO_OAUTH_SCOPES).toEqual([
      "atproto",
      "repo:link.latr.saved.external?action=create&action=update",
      "repo:link.latr.saved.item?action=create&action=update&action=delete",
      "repo:com.latr.saved.external?action=delete",
      "repo:com.latr.saved.item?action=delete",
    ]);
  });
});
