import { describe, expect, test } from "bun:test";

import {
  BOOKMARK_PREVIEW_REPAIR_LIMIT,
  buildLibraryPage,
  libraryPreviewRepairRows,
  nextSavedLibraryPageParam,
  savedLibraryQueryKey,
} from "./useSavedLibrary";
import type { LatrRepo } from "@/lib/latrRepo";
import type { LatrBookmarkView } from "@/lib/latrRecords";

describe("tag-aware saved library pagination", () => {
  test("keys bookmark queries by DID and exact tag", () => {
    expect(savedLibraryQueryKey("did:plc:reader", "café notes")).toEqual([
      "saved-library",
      "did:plc:reader",
      "café notes",
    ]);
    expect(savedLibraryQueryKey("did:plc:reader", "Work")).not.toEqual(
      savedLibraryQueryKey("did:plc:reader", "work")
    );
  });

  test("preserves a cursor on an empty filtered page", async () => {
    let captured: unknown;
    const repo = {
      listSavedItemsPage: async (options: unknown) => {
        captured = options;
        return { records: [], cursor: "raw-next-page" };
      },
    } as unknown as LatrRepo;

    const page = await buildLibraryPage(repo, null, "later match");
    expect(captured).toEqual({
      limit: 50,
      cursor: undefined,
      tag: "later match",
    });
    expect(page.rows).toEqual([]);
    expect(nextSavedLibraryPageParam(page)).toBe("raw-next-page");
  });

  test("returns raw bookmark rows without waiting for remote preview repair", async () => {
    const records: LatrBookmarkView[] = Array.from(
      { length: BOOKMARK_PREVIEW_REPAIR_LIMIT + 2 },
      (_, index) => ({
        uri: `at://did:plc:viewer/community.lexicon.bookmarks.bookmark/${index}`,
        cid: `bafy-${index}`,
        value: {
          $type: "community.lexicon.bookmarks.bookmark",
          subject: `https://example.com/raw-${index}`,
          createdAt: `2026-08-24T01:39:${17 - index}.000Z`,
        },
      })
    );
    const requested: string[] = [];
    const repo = {
      listSavedItemsPage: async () => ({ records, cursor: null }),
      fetchOpenGraphPreview: async (url: string) => {
        requested.push(url);
        throw new Error("Initial page must not fetch a publisher preview");
      },
    } as unknown as LatrRepo;

    const page = await buildLibraryPage(repo, null);

    expect(requested).toHaveLength(0);
    expect(page.rows[0]?.preview.title).toBe("https://example.com/raw-0");
    expect(page.rows.at(-1)?.preview.title).toBe(
      `https://example.com/raw-${BOOKMARK_PREVIEW_REPAIR_LIMIT + 1}`
    );
    expect(libraryPreviewRepairRows([page])).toHaveLength(BOOKMARK_PREVIEW_REPAIR_LIMIT);
    const native = {
      ...page.rows.at(-1)!,
      rec: {
        ...page.rows.at(-1)!.rec,
        value: {
          ...page.rows.at(-1)!.rec.value,
          subject: "at://did:plc:author/app.bsky.feed.post/native",
        },
      },
    };
    const overlap = { ...page.rows[0]!, rec: { ...page.rows[0]!.rec, cid: "older-cid" } };
    const repairs = libraryPreviewRepairRows([
      { ...page, rows: [...page.rows.slice(0, -1), native] },
      { rows: [overlap], cursor: null },
    ]);
    expect(repairs).toHaveLength(BOOKMARK_PREVIEW_REPAIR_LIMIT + 1);
    expect(repairs.at(-1)).toBe(native);
    expect(repairs[0]?.rec.cid).toBe(page.rows[0]?.rec.cid);
  });

  test("renders persisted previews and unresolved AT records without network enrichment", async () => {
    const records: LatrBookmarkView[] = [
      {
        uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/saved",
        cid: "bafy-saved",
        value: {
          $type: "community.lexicon.bookmarks.bookmark",
          subject: "https://example.com/saved",
          createdAt: "2026-10-26T00:00:00.000Z",
        },
        preview: { title: "Saved title", image: "https://example.com/image.png" },
      },
      {
        uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/post",
        cid: "bafy-post",
        value: {
          $type: "community.lexicon.bookmarks.bookmark",
          subject: "at://did:plc:author/app.bsky.feed.post/post",
          createdAt: "2026-10-26T00:00:00.000Z",
        },
      },
    ];
    const repo = {
      listSavedItemsPage: async () => ({ records, cursor: "next" }),
    } as unknown as LatrRepo;
    const page = await buildLibraryPage(repo, null);
    expect(page.rows[0]?.preview.title).toBe("Saved title");
    expect(page.rows[0]?.preview.imageHref).toBe("https://example.com/image.png");
    expect(page.rows[1]?.preview.kind).toBe("post");
    expect(page.cursor).toBe("next");
  });
});
