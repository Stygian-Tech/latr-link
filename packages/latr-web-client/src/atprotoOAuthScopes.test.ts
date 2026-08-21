import { describe, expect, test } from "bun:test";

import {
  LATR_ATPROTO_OAUTH_SCOPES,
  LATR_BOOKMARK_REPO_OAUTH_SCOPES,
  LATR_MIGRATION_CLEANUP_REPO_OAUTH_SCOPES,
  LATR_READING_STATE_PERMISSION_SCOPE,
} from "./atprotoOAuthScopes";

describe("LATR_ATPROTO_OAUTH_SCOPES", () => {
  test("requests only the repository mutations used by L@tr", () => {
    expect(LATR_ATPROTO_OAUTH_SCOPES).toEqual([
      "atproto",
      "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete",
      "include:link.latr.authFull",
      "repo:link.latr.saved.external?action=delete",
      "repo:link.latr.saved.item?action=delete",
      "repo:com.latr.saved.external?action=delete",
      "repo:com.latr.saved.item?action=delete",
    ]);
  });

  test("keeps user-facing permission groups explicit and narrow", () => {
    expect(LATR_BOOKMARK_REPO_OAUTH_SCOPES).toEqual([
      "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete",
    ]);
    expect(LATR_READING_STATE_PERMISSION_SCOPE).toBe("include:link.latr.authFull");
    expect(LATR_MIGRATION_CLEANUP_REPO_OAUTH_SCOPES).toEqual([
      "repo:link.latr.saved.external?action=delete",
      "repo:link.latr.saved.item?action=delete",
      "repo:com.latr.saved.external?action=delete",
      "repo:com.latr.saved.item?action=delete",
    ]);
  });

  test("does not request transition or wildcard repository permissions", () => {
    const scope = LATR_ATPROTO_OAUTH_SCOPES.join(" ");
    expect(scope).not.toContain("transition:generic");
    expect(scope).not.toContain("repo:*");
    expect(scope).not.toContain("repo:link.latr.bookmarks.metadata");
  });
});
