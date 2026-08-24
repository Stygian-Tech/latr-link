import { describe, expect, test } from "bun:test";

import {
  BOOKMARK_PREVIEW_REPAIR_LIMIT,
  buildLibraryPage,
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

  test("repairs only one bounded batch of raw bookmark previews", async () => {
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
        return { title: `Hydrated ${url}` };
      },
    } as unknown as LatrRepo;

    const page = await buildLibraryPage(repo, null);

    expect(requested).toHaveLength(BOOKMARK_PREVIEW_REPAIR_LIMIT);
    expect(page.rows[0]?.preview.title).toStartWith("Hydrated ");
    expect(page.rows.at(-1)?.preview.title).toBe(
      `https://example.com/raw-${BOOKMARK_PREVIEW_REPAIR_LIMIT + 1}`
    );
  });
});
