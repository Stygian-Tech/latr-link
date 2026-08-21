import { describe, expect, test } from "bun:test";

import {
  BookmarkTagValidationError,
  MAX_BOOKMARK_TAG_BYTES,
  appendBookmarkTag,
  bookmarkTagByteCount,
  bookmarkTagGraphemeCount,
  normalizeBookmarkTags,
  splitAuthoredBookmarkTags,
} from "./bookmarkTags";

describe("bookmark tags", () => {
  test("trims authored boundaries and exact-dedupes while preserving case and spaces", () => {
    expect(
      normalizeBookmarkTags([
        "  funny videos  ",
        "Work",
        "work",
        "funny videos",
      ])
    ).toEqual(["funny videos", "Work", "work"]);
  });

  test("rejects empty authored values", () => {
    expect(() => normalizeBookmarkTags(["reading", "   "])).toThrow(
      BookmarkTagValidationError
    );
  });

  test("counts extended grapheme clusters rather than UTF-16 code units", () => {
    expect(bookmarkTagGraphemeCount("👨‍👩‍👧‍👦")).toBe(1);
    expect(bookmarkTagGraphemeCount("e\u0301")).toBe(1);
  });

  test("enforces grapheme and UTF-8 byte limits", () => {
    expect(() => normalizeBookmarkTags(["a".repeat(65)])).toThrow(
      "at most 64 characters"
    );
    expect(bookmarkTagByteCount("é".repeat(MAX_BOOKMARK_TAG_BYTES / 2))).toBe(
      MAX_BOOKMARK_TAG_BYTES
    );
    expect(() =>
      normalizeBookmarkTags(["👨‍👩‍👧‍👦".repeat(64)])
    ).toThrow("at most 640 UTF-8 bytes");
  });

  test("enforces the per-bookmark tag count after deduplication", () => {
    expect(() =>
      normalizeBookmarkTags(Array.from({ length: 101 }, (_, index) => `tag-${index}`))
    ).toThrow("at most 100 tags");
  });

  test("parses comma-separated authored values and appends exact tags", () => {
    expect(splitAuthoredBookmarkTags(" work, funny videos, ,Later ")).toEqual([
      "work",
      "funny videos",
      "Later",
    ]);
    expect(appendBookmarkTag(["work"], " Work ")).toEqual(["work", "Work"]);
  });
});
