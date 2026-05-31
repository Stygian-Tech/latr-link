import { afterEach, describe, expect, test } from "bun:test";

import type { SavedItemRecord } from "@/lib/latrRecords";
import type { RepoRecord } from "@/lib/latrRepo";
import {
  previewFromSavedItemRecord,
  savedItemHasProtocolPreview,
} from "@/lib/resolveSubject";
import {
  previewCacheFingerprint,
  readCachedSubjectPreview,
  writeCachedSubjectPreview,
} from "@/lib/savedPreviewCache";

const externalSubject =
  "at://did:plc:viewer/com.latr.saved.external/3abc";

function savedItem(
  overrides: Partial<SavedItemRecord> = {}
): RepoRecord<SavedItemRecord> {
  return {
    uri: "at://did:plc:viewer/com.latr.saved.item/item1",
    cid: "bafyitem",
    value: {
      $type: "com.latr.saved.item",
      subjectUri: externalSubject,
      savedAt: "2026-05-31T12:00:00.000Z",
      linkedWebUrl: "https://example.com/article",
      previewTitle: "Example Headline",
      previewImage: "https://example.com/og.png",
      previewAuthor: "Jane Doe",
      previewExcerpt: "Short Summary",
      previewSite: "Example",
      ...overrides,
    },
  };
}

afterEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("latr.link.saved-preview.v2");
  }
});

describe("Saved Item Has Protocol Preview", () => {
  test("Detects Cached Preview Fields on Saved Items", () => {
    expect(savedItemHasProtocolPreview(savedItem().value)).toBe(true);
    expect(
      savedItemHasProtocolPreview({
        ...savedItem().value,
        previewTitle: undefined,
        previewImage: undefined,
        previewAuthor: undefined,
        previewExcerpt: undefined,
        previewSite: undefined,
      })
    ).toBe(false);
  });
});

describe("Preview from Saved Item Record", () => {
  test("Uses On-protocol Title, Thumbnail, and Author for External Saves", () => {
    const preview = previewFromSavedItemRecord(savedItem());
    expect(preview).toEqual({
      kind: "external",
      title: "Example Headline",
      subtitle: "Short Summary",
      href: "https://example.com/article",
      imageHref: "https://example.com/og.png",
      canonicalUrl: "https://example.com/article",
      siteLabel: "Example",
      authorLabel: "Jane Doe",
    });
  });

  test("Falls Back to Author-only Subtitle when Excerpt is Missing", () => {
    const preview = previewFromSavedItemRecord(
      savedItem({
        previewExcerpt: undefined,
      })
    );
    expect(preview?.subtitle).toBe("By Jane Doe");
  });

  test("Native Subject With linkedWebUrl Is Not Classified as External", () => {
    const preview = previewFromSavedItemRecord(
      savedItem({
        subjectUri: "at://did:plc:author/app.bsky.feed.post/3abc",
        previewTitle: "Hello World",
      })
    );
    expect(preview?.kind).toBe("post");
  });
});

describe("Saved Preview Cache", () => {
  test("Stores and Reads Previews Keyed by Subject Fingerprint", () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
          removeItem: (key: string) => {
            store.delete(key);
          },
        },
      },
      configurable: true,
    });

    const rec = savedItem();
    const fingerprint = previewCacheFingerprint(rec.value);
    const preview = previewFromSavedItemRecord(rec)!;

    writeCachedSubjectPreview(rec.value.subjectUri, fingerprint, preview);
    expect(readCachedSubjectPreview(rec.value.subjectUri, fingerprint)).toEqual(
      preview
    );
    expect(
      readCachedSubjectPreview(rec.value.subjectUri, "stale-fingerprint")
    ).toBeNull();
  });
});
