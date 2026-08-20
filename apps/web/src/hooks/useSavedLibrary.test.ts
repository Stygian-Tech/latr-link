import { describe, expect, test } from "bun:test";

import {
  buildLibraryPage,
  nextSavedLibraryPageParam,
  savedLibraryQueryKey,
} from "./useSavedLibrary";
import type { LatrRepo } from "@/lib/latrRepo";

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
});
