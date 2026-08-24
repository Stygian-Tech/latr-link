import { describe, expect, test } from "bun:test";

import { COLLECTION_BOOKMARK } from "@/lib/latrRecords";
import type { SavedRow } from "@/lib/savedLibraryTypes";
import { savedRowContentBucket, savedRowOpenTarget } from "./savedRowContent";

function row(overrides: {
  subjectUri?: string;
  linkedWebUrl?: string;
  preview?: Partial<SavedRow["preview"]>;
}): SavedRow {
  const subjectUri =
    overrides.subjectUri ??
    "at://did:plc:viewer/link.latr.saved.external/nonarticle";
  const linkedWebUrl = overrides.linkedWebUrl;
  return {
    rec: {
      uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/test",
      cid: "bafytest",
      value: {
        $type: COLLECTION_BOOKMARK,
        subject: subjectUri,
        createdAt: "2026-07-07T12:00:00.000Z",
      },
    },
    preview: {
      kind: "external",
      title: "Saved from example.com",
      href: linkedWebUrl,
      canonicalUrl: linkedWebUrl,
      ...overrides.preview,
    },
  };
}

describe("Saved Row Content Buckets", () => {
  test("Treats Bluesky Posts as Social", () => {
    expect(
      savedRowContentBucket(
        row({
          subjectUri: "at://did:plc:author/app.bsky.feed.post/3abc",
          preview: { kind: "post", title: "A social post" },
        })
      )
    ).toBe("social");
  });

  test("Treats Extension-saved Bluesky HTTP Posts as Social", () => {
    expect(
      savedRowContentBucket(
        row({
          subjectUri: "https://bsky.app/profile/alice.test/post/3abc",
          linkedWebUrl: "https://bsky.app/profile/alice.test/post/3abc",
          preview: { kind: "external", title: "A social post" },
        })
      )
    ).toBe("social");
  });

  test("Treats Standard Site AT Records as Articles", () => {
    expect(
      savedRowContentBucket(
        row({
          subjectUri: "at://did:plc:author/site.standard.article/3abc",
          preview: { kind: "external", title: "Longform Article" },
        })
      )
    ).toBe("article");
  });

  test("Treats Non-article Links as Other", () => {
    expect(
      savedRowContentBucket(
        row({
          linkedWebUrl: "https://example.com",
          preview: {
            kind: "external",
            title: "Saved from example.com",
            siteLabel: "example.com",
          },
        })
      )
    ).toBe("other");
  });
});

describe("Saved Row Open Targets", () => {
  test("Opens Articles in a New Tab", () => {
    expect(
      savedRowOpenTarget(
        savedRowContentBucket(
          row({
            linkedWebUrl: "https://example.com/news/article",
            preview: { title: "Longform Article" },
          })
        )
      )
    ).toBe("new-tab");
  });

  test("Keeps Social Posts in the Embedded Reader", () => {
    expect(
      savedRowOpenTarget(
        savedRowContentBucket(
          row({
            subjectUri: "https://bsky.app/profile/alice.test/post/3abc",
            linkedWebUrl: "https://bsky.app/profile/alice.test/post/3abc",
            preview: { kind: "external", title: "A social post" },
          })
        )
      )
    ).toBe("embedded");
  });

  test("Keeps Non-article Links in the Embedded Reader", () => {
    expect(
      savedRowOpenTarget(
        savedRowContentBucket(
          row({
            linkedWebUrl: "https://example.com",
            preview: {
              title: "Saved from example.com",
              siteLabel: "example.com",
            },
          })
        )
      )
    ).toBe("embedded");
  });
});
