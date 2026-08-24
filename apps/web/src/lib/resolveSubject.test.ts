import { afterEach, describe, expect, test } from "bun:test";

import type { LatrBookmarkView, SavedItemRecord } from "@/lib/latrRecords";
import type { LatrRepo, RepoRecord } from "@/lib/latrRepo";
import {
  previewFromSavedItemRecord,
  previewHasRichMetadata,
  previewKindForSavedItemRecord,
  resolveBookmarkPreviewForRow,
  savedItemHasProtocolPreview,
} from "@/lib/resolveSubject";
import {
  previewCacheFingerprint,
  readCachedSubjectPreview,
  removeCachedSubjectPreview,
  writeCachedSubjectPreview,
} from "@/lib/savedPreviewCache";

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

function bookmark(
  preview?: LatrBookmarkView["preview"],
  subject = "https://example.com/article"
): LatrBookmarkView {
  return {
    uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/3abc",
    cid: "bafybookmark",
    value: {
      $type: "community.lexicon.bookmarks.bookmark",
      subject,
      createdAt: "2026-08-24T01:39:17.000Z",
    },
    ...(preview ? { preview } : {}),
  };
}

function repoWithOpenGraph(
  fetchOpenGraphPreview: LatrRepo["fetchOpenGraphPreview"]
): LatrRepo {
  return { fetchOpenGraphPreview } as LatrRepo;
}

afterEach(() => {
  removeCachedSubjectPreview("https://example.com/article");
  for (let index = 0; index < 8; index += 1) {
    removeCachedSubjectPreview(`https://example.com/article-${index}`);
  }
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("latr.link.saved-preview.v7");
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

describe("Bookmark Preview Hydration", () => {
  test("Backfills a raw HTTP bookmark when the list response has no preview", async () => {
    const requested: string[] = [];
    const repo = repoWithOpenGraph(async (url) => {
      requested.push(url);
      return {
        title: "Example Headline",
        description: "Short Summary",
        image: "https://example.com/og.png",
        siteName: "Example",
        author: "Jane Doe",
      };
    });

    const preview = await resolveBookmarkPreviewForRow(repo, bookmark());
    const cachedPreview = await resolveBookmarkPreviewForRow(repo, bookmark(), {
      repairWeakHttpPreview: false,
    });

    expect(requested).toEqual(["https://example.com/article"]);
    expect(cachedPreview).toEqual(preview);
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

  test("Does not refetch a strong preview merely because its image is missing", async () => {
    let calls = 0;
    const repo = repoWithOpenGraph(async () => {
      calls += 1;
      return null;
    });

    const preview = await resolveBookmarkPreviewForRow(
      repo,
      bookmark({ title: "Canonical Headline", siteName: "Canonical Site" })
    );

    expect(calls).toBe(0);
    expect(preview.title).toBe("Canonical Headline");
    expect(preview.imageHref).toBeUndefined();
    expect(preview.siteLabel).toBe("Canonical Site");
  });

  test("Preserves a canonical site name while repairing a weak title", async () => {
    const repo = repoWithOpenGraph(async () => ({
      title: "Canonical Headline",
      siteName: "Fetched Site",
    }));

    const preview = await resolveBookmarkPreviewForRow(
      repo,
      bookmark({
        title: "https://example.com/article",
        siteName: "Canonical Site",
      })
    );

    expect(preview.title).toBe("Canonical Headline");
    expect(preview.siteLabel).toBe("Canonical Site");
  });

  test("Limits concurrent repair requests for a page of raw bookmarks", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseRequests: (() => void) | undefined;
    const requestsCanFinish = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const repo = repoWithOpenGraph(async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await requestsCanFinish;
      active -= 1;
      return { title: `Title for ${url}` };
    });

    const pending = Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        resolveBookmarkPreviewForRow(
          repo,
          bookmark(undefined, `https://example.com/article-${index}`)
        )
      )
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(maximumActive).toBe(4);
    releaseRequests?.();
    await pending;
    expect(maximumActive).toBe(4);
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
});
