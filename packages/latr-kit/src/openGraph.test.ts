import { describe, expect, test } from "bun:test";
import {
  applyOgToExternal,
  applyOgToSavedItem,
  externalNeedsOgEnrichment,
  OG_FIELD_MAX,
  savedItemNeedsOgEnrichment,
} from "./openGraph";
import {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  type SavedExternalRecord,
  type SavedItemRecord,
} from "./types";

describe("externalNeedsOgEnrichment", () => {
  test("needs fetch when title or image missing", () => {
    const base: SavedExternalRecord = {
      $type: COLLECTION_SAVED_EXTERNAL,
      url: "https://a.com",
      normalizedUrl: "https://a.com",
      fingerprint: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(externalNeedsOgEnrichment(base)).toBe(true);
    expect(
      externalNeedsOgEnrichment({ ...base, title: "T", image: "https://img" })
    ).toBe(false);
  });
});

describe("applyOgToExternal", () => {
  test("fills sparse fields and truncates to lexicon max", () => {
    const existing: SavedExternalRecord = {
      $type: COLLECTION_SAVED_EXTERNAL,
      url: "https://a.com",
      normalizedUrl: "https://a.com",
      fingerprint: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "Keep",
    };
    const longDesc = "x".repeat(OG_FIELD_MAX.excerpt + 50);
    const merged = applyOgToExternal(existing, {
      title: "New",
      description: longDesc,
      image: "https://cdn/x.png",
      siteName: "Site",
      author: "Author",
    });
    expect(merged?.title).toBe("Keep");
    expect(merged?.excerpt?.length).toBe(OG_FIELD_MAX.excerpt);
    expect(merged?.image).toBe("https://cdn/x.png");
    expect(merged?.site).toBe("Site");
    expect(merged?.author).toBe("Author");
  });

  test("returns null when nothing changes", () => {
    const existing: SavedExternalRecord = {
      $type: COLLECTION_SAVED_EXTERNAL,
      url: "https://a.com",
      normalizedUrl: "https://a.com",
      fingerprint: "abc",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "T",
      image: "https://img",
    };
    expect(applyOgToExternal(existing, { title: "Other" })).toBeNull();
  });
});

describe("applyOgToSavedItem", () => {
  test("maps OG fields to preview* properties", () => {
    const existing: SavedItemRecord = {
      $type: COLLECTION_SAVED_ITEM,
      subjectUri: "at://did/app.bsky.feed.post/abc",
      savedAt: "2026-01-01T00:00:00.000Z",
    };
    const merged = applyOgToSavedItem(existing, {
      title: "Article",
      description: "Desc",
      image: "https://img",
      siteName: "Example",
      author: "Sam",
    });
    expect(merged?.previewTitle).toBe("Article");
    expect(merged?.previewExcerpt).toBe("Desc");
    expect(merged?.previewImage).toBe("https://img");
    expect(merged?.previewSite).toBe("Example");
    expect(merged?.previewAuthor).toBe("Sam");
  });

  test("savedItemNeedsOgEnrichment requires title and image", () => {
    const item: SavedItemRecord = {
      $type: COLLECTION_SAVED_ITEM,
      subjectUri: "at://did/app.bsky.feed.post/abc",
      savedAt: "2026-01-01T00:00:00.000Z",
      previewTitle: "T",
    };
    expect(savedItemNeedsOgEnrichment(item)).toBe(true);
    expect(
      savedItemNeedsOgEnrichment({
        ...item,
        previewImage: "https://img",
      })
    ).toBe(false);
  });
});
