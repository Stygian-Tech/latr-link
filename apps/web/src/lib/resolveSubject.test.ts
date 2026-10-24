import { afterEach, describe, expect, test } from "bun:test";

import type { SavedItemRecord } from "@/lib/latrRecords";
import type { RepoRecord } from "@/lib/latrRepo";
import {
  previewFromSavedItemRecord,
  previewHasRichMetadata,
  previewKindForSavedItemRecord,
  savedItemHasProtocolPreview,
} from "@/lib/resolveSubject";
import {
  previewCacheFingerprint,
  readCachedSubjectPreview,
  writeCachedSubjectPreview,
} from "@/lib/savedPreviewCache";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const externalSubject =
  "at://did:plc:viewer/link.latr.saved.external/3abc";

function savedItem(
  overrides: Partial<SavedItemRecord> = {}
): RepoRecord<SavedItemRecord> {
  return {
    uri: "at://did:plc:viewer/link.latr.saved.item/item1",
    cid: "bafyitem",
    value: {
      $type: "link.latr.saved.item",
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
    window.localStorage.removeItem("latr.link.saved-preview.v7");
  }
  // Later server-component imports must not mistake this localStorage mock for a browser.
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
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

  test("Bluesky Subject With linkedWebUrl Is Still Classified as a Post", () => {
    const preview = previewFromSavedItemRecord(
      savedItem({
        subjectUri: "at://did:plc:author/app.bsky.feed.post/3abc",
        previewTitle: "Hello World",
      })
    );
    expect(preview?.kind).toBe("post");
  });

  test("Standard Site Article Subjects Are Classified as External Articles", () => {
    const record = savedItem({
      subjectUri: "at://did:plc:author/site.standard.article/3abc",
      linkedWebUrl: undefined,
      previewTitle: "Longform Article",
      previewSite: "standard.site",
    });

    expect(previewKindForSavedItemRecord(record.value)).toBe("external");
    expect(previewFromSavedItemRecord(record)?.kind).toBe("external");
  });
});

describe("Preview Has Rich Metadata", () => {
  test("URL-only Title Is Not Rich When linkedWebUrl Is Set", () => {
    expect(
      previewHasRichMetadata(
        {
          kind: "external",
          title: "https://example.com/article",
          href: "https://example.com/article",
        },
        savedItem().value
      )
    ).toBe(false);
  });

  test("Title With Image Is Rich", () => {
    expect(
      previewHasRichMetadata(
        {
          kind: "external",
          title: "Example Headline",
          imageHref: "https://example.com/og.png",
        },
        savedItem().value
      )
    ).toBe(true);
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

  test("Restores the Browser Global after the Storage Fixture", () => {
    expect(Object.getOwnPropertyDescriptor(globalThis, "window")).toEqual(
      originalWindow
    );
  });
});
