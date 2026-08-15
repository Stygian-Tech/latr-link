import { describe, expect, test } from "bun:test";

import { LATR_ATPROTO_OAUTH_SCOPES } from "./atprotoOAuthScopes";

describe("LATR_ATPROTO_OAUTH_SCOPES", () => {
  test("requests only the repository mutations used by L@tr", () => {
    expect(LATR_ATPROTO_OAUTH_SCOPES).toEqual([
      "atproto",
      "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete",
      "repo:link.latr.bookmarks.metadata?action=create&action=update&action=delete",
      "repo:link.latr.saved.external?action=delete",
      "repo:link.latr.saved.item?action=delete",
      "repo:com.latr.saved.external?action=delete",
      "repo:com.latr.saved.item?action=delete",
    ]);
  });
});
