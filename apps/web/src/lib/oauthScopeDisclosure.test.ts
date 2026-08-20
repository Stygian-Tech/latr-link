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

  test("states the important access limitations", () => {
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("cannot post to feeds");
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("read messages or email");
    expect(OAUTH_SCOPE_LIMITATION_DISCLOSURE).toContain("manage your account");
  });
});
