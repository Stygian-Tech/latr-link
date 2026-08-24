import { describe, expect, test } from "bun:test";

import {
  MAX_BOOKMARK_TAG_BYTES,
  normalizeBookmarkTags,
  bookmarkTagByteCount,
  bookmarkTagGraphemeCount,
  splitAuthoredBookmarkTags,
} from "./bookmarkTags";

describe("bookmark tags", () => {
  test("trims and exact-dedupes while preserving case and internal spaces", () => {
    expect(
      normalizeBookmarkTags(["  funny videos  ", "Work", "work", "funny videos"])
    ).toEqual(["funny videos", "Work", "work"]);
  });

  test("parses comma-delimited authored values", () => {
    expect(splitAuthoredBookmarkTags(" work, funny videos, ,Later ")).toEqual([
      "work",
      "funny videos",
      "Later",
    ]);
  });

  test("enforces empty, count, grapheme, and UTF-8 byte limits", () => {
    expect(() => normalizeBookmarkTags([" "])).toThrow("cannot be empty");
    expect(() => normalizeBookmarkTags(Array.from({ length: 101 }, (_, i) => `tag-${i}`))).toThrow("at most 100 tags");
    expect(bookmarkTagGraphemeCount("👨‍👩‍👧‍👦")).toBe(1);
    expect(() => normalizeBookmarkTags(["a".repeat(65)])).toThrow("at most 64 characters");
    expect(bookmarkTagByteCount("é".repeat(MAX_BOOKMARK_TAG_BYTES / 2))).toBe(MAX_BOOKMARK_TAG_BYTES);
    expect(() => normalizeBookmarkTags(["👨‍👩‍👧‍👦".repeat(64)])).toThrow("at most 640 UTF-8 bytes");
  });
});
