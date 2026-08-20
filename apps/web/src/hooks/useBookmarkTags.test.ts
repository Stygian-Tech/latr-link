import { describe, expect, test } from "bun:test";
import { LatrGatewayError } from "latr-web-client";

import {
  BulkTagOperationError,
  loadCompleteBookmarkTagInventory,
  runBulkBookmarkTagOperation,
} from "./useBookmarkTags";
import type { LatrRepo } from "@/lib/latrRepo";

describe("loadCompleteBookmarkTagInventory", () => {
  test("drains every cursor and merges exact case-sensitive counts", async () => {
    const pages = new Map([
      [
        "",
        {
          tagCounts: [
            { tag: "Work", count: 2 },
            { tag: "work", count: 1 },
          ],
          scanned: 100,
          cursor: "next",
        },
      ],
      [
        "next",
        {
          tagCounts: [
            { tag: "Work", count: 3 },
            { tag: "funny videos", count: 1 },
          ],
          scanned: 20,
          cursor: null,
        },
      ],
    ]);
    const repo = {
      listBookmarkTagsPage: async ({ cursor }: { cursor?: string }) =>
        pages.get(cursor ?? "")!,
    } as unknown as LatrRepo;

    expect(await loadCompleteBookmarkTagInventory(repo)).toEqual([
      { tag: "funny videos", count: 1 },
      { tag: "work", count: 1 },
      { tag: "Work", count: 5 },
    ]);
  });

  test("continues across an empty page with a cursor", async () => {
    let calls = 0;
    const repo = {
      listBookmarkTagsPage: async () => {
        calls += 1;
        return calls === 1
          ? { tagCounts: [], scanned: 100, cursor: "later" }
          : {
              tagCounts: [{ tag: "later match", count: 2 }],
              scanned: 2,
              cursor: null,
            };
      },
    } as unknown as LatrRepo;

    expect(await loadCompleteBookmarkTagInventory(repo)).toEqual([
      { tag: "later match", count: 2 },
    ]);
    expect(calls).toBe(2);
  });

  test("rejects a repeated cursor instead of looping forever", async () => {
    const repo = {
      listBookmarkTagsPage: async () => ({
        tagCounts: [],
        scanned: 100,
        cursor: "same",
      }),
    } as unknown as LatrRepo;

    expect(loadCompleteBookmarkTagInventory(repo)).rejects.toThrow(
      "repeated cursor"
    );
  });
});

describe("runBulkBookmarkTagOperation", () => {
  test("uses bounded 25-record pages and reports cumulative progress", async () => {
    const cursors: Array<string | undefined> = [];
    const repo = {
      renameBookmarkTag: async (
        _tag: string,
        _replacement: string,
        options: { limit?: number; cursor?: string }
      ) => {
        expect(options.limit).toBe(25);
        cursors.push(options.cursor);
        return options.cursor
          ? { ok: true, scanned: 10, matched: 10, updated: 10 }
          : { ok: true, scanned: 25, matched: 25, updated: 25, cursor: "page-2" };
      },
      listBookmarkTagsPage: async () => ({ tagCounts: [], scanned: 35, cursor: null }),
    } as unknown as LatrRepo;

    const progress = await runBulkBookmarkTagOperation(repo, {
      kind: "rename",
      tag: "old",
      replacement: "new",
    });

    expect(cursors).toEqual([undefined, "page-2"]);
    expect(progress).toMatchObject({ scanned: 35, matched: 35, updated: 35 });
  });

  test("retries the same cursor once for a typed XRPC conflict", async () => {
    let calls = 0;
    const repo = {
      deleteBookmarkTag: async () => {
        calls += 1;
        if (calls === 1) throw new LatrGatewayError(409, "Conflict", "CID conflict");
        return { ok: true, scanned: 1, matched: 1, updated: 1 };
      },
      listBookmarkTagsPage: async () => ({ tagCounts: [], scanned: 1, cursor: null }),
    } as unknown as LatrRepo;

    await expect(
      runBulkBookmarkTagOperation(repo, { kind: "delete", tag: "old" })
    ).resolves.toMatchObject({ updated: 1 });
    expect(calls).toBe(2);
  });

  test("surfaces acknowledged progress and resumes from the failed cursor", async () => {
    let failSecondPage = true;
    const repo = {
      deleteBookmarkTag: async (
        _tag: string,
        options: { cursor?: string }
      ) => {
        if (!options.cursor) {
          return { ok: true, scanned: 25, matched: 25, updated: 25, cursor: "resume-here" };
        }
        if (failSecondPage) {
          failSecondPage = false;
          throw new Error("offline");
        }
        return { ok: true, scanned: 5, matched: 5, updated: 5 };
      },
      listBookmarkTagsPage: async () => ({ tagCounts: [], scanned: 30, cursor: null }),
    } as unknown as LatrRepo;

    let failure: BulkTagOperationError | undefined;
    try {
      await runBulkBookmarkTagOperation(repo, { kind: "delete", tag: "old" });
    } catch (error) {
      failure = error as BulkTagOperationError;
    }
    expect(failure).toBeInstanceOf(BulkTagOperationError);
    expect(failure?.resumeCursor).toBe("resume-here");
    expect(failure?.progress.updated).toBe(25);

    const completed = await runBulkBookmarkTagOperation(
      repo,
      { kind: "delete", tag: "old" },
      {
        resumeCursor: failure?.resumeCursor,
        initialProgress: failure?.progress,
      }
    );
    expect(completed.updated).toBe(30);
  });

  test("restarts from the beginning until verification converges", async () => {
    let mutationPasses = 0;
    let verificationPasses = 0;
    const repo = {
      deleteBookmarkTag: async () => {
        mutationPasses += 1;
        return { ok: true, scanned: 1, matched: 1, updated: 1 };
      },
      listBookmarkTagsPage: async () => {
        verificationPasses += 1;
        return {
          tagCounts:
            verificationPasses < 3 ? [{ tag: "old", count: 1 }] : [],
          scanned: 1,
          cursor: null,
        };
      },
    } as unknown as LatrRepo;

    const result = await runBulkBookmarkTagOperation(repo, {
      kind: "delete",
      tag: "old",
    });
    expect(mutationPasses).toBe(3);
    expect(result.convergencePass).toBe(3);
    expect(result.updated).toBe(3);
  });
});
