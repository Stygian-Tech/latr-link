"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLatrGatewayConflictError } from "latr-web-client";

import { useAuth } from "@/hooks/useAuth";
import {
  savedLibraryQueryKey,
  savedLibraryQueryPrefix,
} from "@/hooks/useSavedLibrary";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  createDemoSavedRows,
  deleteSavedRowTag,
  renameSavedRowTag,
  tagCountsForSavedRows,
} from "@/lib/demoLibrary";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import type { LatrRepo } from "@/lib/latrRepo";
import {
  flattenSavedLibraryPages,
  patchSavedLibraryPages,
  type SavedLibraryData,
} from "@/lib/savedLibraryPages";

export type BookmarkTagCount = { tag: string; count: number };

export type BulkTagProgress = {
  scanned: number;
  matched: number;
  updated: number;
  cursor?: string;
  convergencePass: number;
};

export class BulkTagOperationError extends Error {
  constructor(
    message: string,
    readonly progress: BulkTagProgress,
    readonly resumeCursor?: string
  ) {
    super(message);
    this.name = "BulkTagOperationError";
  }
}

export async function loadCompleteBookmarkTagInventory(
  repo: LatrRepo
): Promise<BookmarkTagCount[]> {
  const counts = new Map<string, number>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await repo.listBookmarkTagsPage({ limit: 100, cursor });
    for (const { tag, count } of page.tagCounts) {
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + count);
    }
    const next = page.cursor ?? undefined;
    if (next && seenCursors.has(next)) {
      throw new Error("Tag inventory returned a repeated cursor.");
    }
    if (next) seenCursors.add(next);
    cursor = next;
  } while (cursor);

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => left.tag.localeCompare(right.tag, "en-US"));
}

export function useBookmarkTagInventory() {
  const { session } = useAuth();
  const repo = useLatrRepo();
  const queryClient = useQueryClient();
  const demoMode = isLatrDemoDataEnabled();

  const query = useQuery({
    queryKey: ["bookmark-tags", session?.did],
    enabled: !!session && (demoMode || !!repo),
    queryFn: async () => {
      if (!demoMode) {
        if (!repo) throw new Error("Sign In to Load Tags");
        return loadCompleteBookmarkTagInventory(repo);
      }
      const cached = queryClient.getQueryData<SavedLibraryData>(
        savedLibraryQueryKey(session?.did)
      );
      return tagCountsForSavedRows(
        flattenSavedLibraryPages(cached) ?? createDemoSavedRows()
      );
    },
    refetchOnWindowFocus: "always",
  });

  return {
    tags: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    retry: query.refetch,
  };
}

export type BulkTagOperation =
  | { kind: "rename"; tag: string; replacement: string }
  | { kind: "delete"; tag: string };

export async function runBulkBookmarkTagOperation(
  repo: LatrRepo,
  operation: BulkTagOperation,
  options: {
    resumeCursor?: string;
    initialProgress?: BulkTagProgress;
    onProgress?: (progress: BulkTagProgress) => void;
  } = {}
): Promise<BulkTagProgress> {
  let progress: BulkTagProgress = options.initialProgress ?? {
    scanned: 0,
    matched: 0,
    updated: 0,
    convergencePass: 1,
  };
  let cursor = options.resumeCursor;
  let convergencePass = progress.convergencePass || 1;

  try {
    while (convergencePass <= 3) {
      do {
        let result;
        let retriedConflict = false;
        for (;;) {
          try {
            result =
              operation.kind === "rename"
                ? await repo.renameBookmarkTag(
                    operation.tag,
                    operation.replacement,
                    { limit: 25, cursor }
                  )
                : await repo.deleteBookmarkTag(operation.tag, {
                    limit: 25,
                    cursor,
                  });
            break;
          } catch (error) {
            if (!retriedConflict && isLatrGatewayConflictError(error)) {
              retriedConflict = true;
              continue;
            }
            throw error;
          }
        }

        cursor = result.cursor ?? undefined;
        progress = {
          scanned: progress.scanned + result.scanned,
          matched: progress.matched + result.matched,
          updated: progress.updated + result.updated,
          ...(cursor ? { cursor } : {}),
          convergencePass,
        };
        options.onProgress?.(progress);
      } while (cursor);

      const inventory = await loadCompleteBookmarkTagInventory(repo);
      if (!inventory.some(({ tag, count }) => tag === operation.tag && count > 0)) {
        return progress;
      }

      convergencePass += 1;
      cursor = undefined;
      progress = { ...progress, convergencePass };
      options.onProgress?.(progress);
    }

    throw new BulkTagOperationError(
      "Concurrent changes kept reintroducing this tag. Retry when edits have settled.",
      progress
    );
  } catch (error) {
    if (error instanceof BulkTagOperationError) throw error;
    throw new BulkTagOperationError(
      error instanceof Error ? error.message : "Tag operation failed.",
      progress,
      cursor
    );
  }
}

export function useBulkBookmarkTagMutation() {
  const { session } = useAuth();
  const did = session?.did;
  const repo = useLatrRepo();
  const queryClient = useQueryClient();
  const demoMode = isLatrDemoDataEnabled();

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: savedLibraryQueryPrefix(did),
      }),
      queryClient.invalidateQueries({
        queryKey: ["bookmark-tags", did],
      }),
    ]);
  }, [did, queryClient]);

  const patchDemo = useCallback(
    (operation: BulkTagOperation) => {
      const prefix = savedLibraryQueryPrefix(did);
      const queries = queryClient.getQueriesData<SavedLibraryData>({
        queryKey: prefix,
      });
      for (const [queryKey, data] of queries) {
        const activeTag = String(queryKey[2] ?? "") || undefined;
        queryClient.setQueryData<SavedLibraryData>(
          queryKey,
          patchSavedLibraryPages(data, (rows) => {
            const changed =
              operation.kind === "rename"
                ? renameSavedRowTag(rows, operation.tag, operation.replacement)
                : deleteSavedRowTag(rows, operation.tag);
            return activeTag
              ? changed.filter((row) => row.rec.value.tags?.includes(activeTag))
              : changed;
          })
        );
      }
    },
    [did, queryClient]
  );

  const run = useCallback(
    async (
      operation: BulkTagOperation,
      options: {
        resumeCursor?: string;
        initialProgress?: BulkTagProgress;
        onProgress?: (progress: BulkTagProgress) => void;
      } = {}
    ): Promise<BulkTagProgress> => {
      if (demoMode) {
        patchDemo(operation);
        await queryClient.invalidateQueries({
          queryKey: ["bookmark-tags", did],
        });
        const progress = {
          scanned: 0,
          matched: 0,
          updated: 0,
          convergencePass: 1,
        };
        options.onProgress?.(progress);
        return progress;
      }
      if (!repo) throw new Error("Sign In to Manage Tags");

      try {
        const progress = await runBulkBookmarkTagOperation(repo, operation, options);
        await invalidate();
        return progress;
      } catch (error) {
        await invalidate();
        throw error;
      }
    },
    [demoMode, did, invalidate, patchDemo, queryClient, repo]
  );

  return {
    run,
    canMutate: !!session && (demoMode || !!repo),
  };
}
