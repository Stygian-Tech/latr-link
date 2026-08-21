import { describe, expect, test } from "bun:test";

import {
  OAUTH_SCOPE_DISCLOSURE_GROUPS,
  OAUTH_SCOPE_LIMITATION_DISCLOSURE,
} from "@/lib/oauthScopeDisclosure";

describe("OAuth scope disclosure", () => {
  test("keeps the access groups ordered and user-facing", () => {
    expect(OAUTH_SCOPE_DISCLOSURE_GROUPS.map(({ title }) => title)).toEqual([
      "Bookmarks",
      "Reading State",
      "Migration Cleanup",
      "Feedback and Photos",
    ]);
    expect(OAUTH_SCOPE_DISCLOSURE_GROUPS.at(-1)?.webOnly).toBe(true);
  });

  test("breaks out community bookmark record access by action", () => {
    const bookmarkGroup = OAUTH_SCOPE_DISCLOSURE_GROUPS.find(
      ({ title }) => title === "Bookmarks"
    );

    expect(bookmarkGroup?.collection).toBe(
      "community.lexicon.bookmarks.bookmark"
    );
    expect(bookmarkGroup?.permissions).toEqual([
      {
        action: "Create",
        detail: "Save links as new public bookmark records.",
      },
      {
        action: "Update",
        detail: "Edit tags on existing bookmark records.",
      },
      {
        action: "Delete",
        detail: "Remove bookmark records from your repository.",
      },
    ]);
  });

  test("states the important access limitations", () => {
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("cannot post to feeds");
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("read messages or email");
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("manage your account");
  });
});
