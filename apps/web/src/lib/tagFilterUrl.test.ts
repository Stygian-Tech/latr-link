import { describe, expect, test } from "bun:test";

import { libraryHrefWithTag, selectedBookmarkTag } from "./tagFilterUrl";

describe("bookmark tag URL state", () => {
  test("encodes spaces and Unicode while preserving other filters", () => {
    const params = new URLSearchParams("content=article");
    expect(libraryHrefWithTag("/library", params, "café notes")).toBe(
      "/library?content=article&tag=caf%C3%A9+notes"
    );
  });

  test("clearing a tag removes only the tag parameter", () => {
    const params = new URLSearchParams("content=post&tag=work");
    expect(libraryHrefWithTag("/library/archive", params, undefined)).toBe(
      "/library/archive?content=post"
    );
  });

  test("restores an exact non-empty tag", () => {
    expect(selectedBookmarkTag(new URLSearchParams("tag=Work"))).toBe("Work");
    expect(selectedBookmarkTag(new URLSearchParams("tag=+++"))).toBeUndefined();
  });
});
