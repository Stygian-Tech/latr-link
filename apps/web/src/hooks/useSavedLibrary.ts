"use client";

import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  resolveBookmarkPreviewForRow,
} from "@/lib/resolveSubject";
import type { LatrRepo } from "@/lib/latrRepo";
import type { SavedItemState } from "@/lib/latrRecords";
import { rkeyFromAtUri } from "@/lib/rkey";
import { removeCachedSubjectPreview } from "@/lib/savedPreviewCache";
import {
  createDemoSavedRows,
  removeSavedRow,
  setSavedRowState,
  setSavedRowTags,
} from "@/lib/demoLibrary";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import {
  flattenSavedLibraryPages,
  patchSavedLibraryPages,
  type SavedLibraryData,
  type SavedLibraryPage,
} from "@/lib/savedLibraryPages";
import type { SavedRow } from "@/lib/savedLibraryTypes";
import { selectedBookmarkTag } from "@/lib/tagFilterUrl";

export type { SavedRow } from "@/lib/savedLibraryTypes";

export const SAVED_LIBRARY_PAGE_SIZE = 50;

export function nextSavedLibraryPageParam(
  page: SavedLibraryPage
): string | undefined {
  return page.cursor ?? undefined;
}

export async function buildLibraryPage(
  repo: LatrRepo,
  cursor: string | null,
  tag?: string
): Promise<SavedLibraryPage> {
  const page = await repo.listSavedItemsPage({
    limit: SAVED_LIBRARY_PAGE_SIZE,
    cursor: cursor ?? undefined,
    tag,
  });
  const rows: SavedRow[] = await Promise.all(
    page.records.map(async (rec) => ({
      rec,
      preview: await resolveBookmarkPreviewForRow(repo, rec),
    }))
  );
  return { rows, cursor: page.cursor };
}

export function useSavedLibrary(options: { ignoreTag?: boolean } = {}) {
  const repo = useLatrRepo();
  const { session } = useAuth();
  const demoMode = isLatrDemoDataEnabled();
  const searchParams = useSearchParams();
  const tag = options.ignoreTag ? undefined : selectedBookmarkTag(searchParams);

  const query = useInfiniteQuery({
    queryKey: savedLibraryQueryKey(session?.did, tag),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<SavedLibraryPage> =>
      demoMode
        ? Promise.resolve({
            rows: createDemoSavedRows().filter((row) =>
              tag ? row.rec.value.tags?.includes(tag) : true
            ),
            cursor: null,
          })
        : buildLibraryPage(repo!, pageParam, tag),
    getNextPageParam: nextSavedLibraryPageParam,
    enabled: !!session && (demoMode || !!repo),
    refetchOnWindowFocus: "always",
  });

  const data = useMemo(
    () => flattenSavedLibraryPages(query.data),
    [query.data]
  );

  return {
    data,
    isLoading: query.isLoading,
    error: query.error,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    activeTag: tag,
  };
}

export function useInvalidateSavedLibrary() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const did = session?.did;
  return () => {
    void queryClient.invalidateQueries({
      queryKey: savedLibraryQueryPrefix(did),
    });
  };
}

export function savedLibraryQueryKey(
  did: string | undefined,
  tag?: string
) {
  return ["saved-library", did, tag ?? ""] as const;
}

export function savedLibraryQueryPrefix(did: string | undefined) {
  return ["saved-library", did] as const;
}

export function useSavedLibraryMutations() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const did = session?.did;
  const repo = useLatrRepo();
  const demoMode = isLatrDemoDataEnabled();
  const queryPrefix = savedLibraryQueryPrefix(did);

  const cachedQueries = useCallback(
    () =>
      queryClient.getQueriesData<SavedLibraryData>({
        queryKey: queryPrefix,
      }),
    [queryClient, queryPrefix]
  );

  const patchRows = useCallback(
    (
      updater: (rows: SavedRow[]) => SavedRow[],
      reconcileTagFilters = false
    ) => {
      for (const [queryKey, data] of cachedQueries()) {
        const activeTag = String(queryKey[2] ?? "") || undefined;
        queryClient.setQueryData<SavedLibraryData>(
          queryKey,
          patchSavedLibraryPages(data, (rows) => {
            const next = updater(rows);
            return reconcileTagFilters && activeTag
              ? next.filter((row) => row.rec.value.tags?.includes(activeTag))
              : next;
          })
        );
      }
    },
    [cachedQueries, queryClient]
  );

  const restoreQueries = useCallback(
    (previous: ReturnType<typeof cachedQueries>) => {
      for (const [queryKey, data] of previous) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    [queryClient]
  );

  const findCachedRow = useCallback(
    (predicate: (row: SavedRow) => boolean) => {
      for (const [, data] of cachedQueries()) {
        const row = flattenSavedLibraryPages(data)?.find(predicate);
        if (row) return row;
      }
      return undefined;
    },
    [cachedQueries]
  );

  const setItemState = useCallback(
    async (itemRkey: string, state: SavedItemState) => {
      if (!repo && !demoMode) throw new Error("Sign In to Update Saved Items");

      const previous = cachedQueries();
      const bookmarkUri = findCachedRow(
        (row) => rkeyFromAtUri(row.rec.uri) === itemRkey
      )?.rec.uri;
      patchRows((rows) =>
        setSavedRowState(
          rows,
          itemRkey,
          state,
          state === "archived" ? new Date().toISOString() : undefined
        )
      );

      if (demoMode) return;
      if (!repo) throw new Error("Sign In to Update Saved Items");

      try {
        if (!bookmarkUri) throw new Error("Bookmark Not Found");
        await repo.setItemState(bookmarkUri, state);
      } catch (error) {
        restoreQueries(previous);
        throw error;
      }
    },
    [cachedQueries, demoMode, findCachedRow, patchRows, repo, restoreQueries]
  );

  const unsave = useCallback(
    async (itemRkey: string) => {
      if (!repo && !demoMode) throw new Error("Sign In to Remove Saved Items");

      const previous = cachedQueries();
      const removed = findCachedRow(
        (row) => rkeyFromAtUri(row.rec.uri) === itemRkey
      );
      patchRows((rows) => removeSavedRow(rows, itemRkey));

      if (demoMode) return;
      if (!repo) throw new Error("Sign In to Remove Saved Items");

      try {
        const bookmarkUri = removed?.rec.uri;
        if (!bookmarkUri) throw new Error("Bookmark Not Found");
        await repo.unsave(bookmarkUri);
        if (removed) {
          removeCachedSubjectPreview(removed.rec.value.subject);
        }
      } catch (error) {
        restoreQueries(previous);
        throw error;
      }
    },
    [cachedQueries, demoMode, findCachedRow, patchRows, repo, restoreQueries]
  );

  const setItemTags = useCallback(
    async (bookmarkUri: string, tags: string[]) => {
      if (!repo && !demoMode) throw new Error("Sign In to Update Tags");

      const previous = cachedQueries();
      patchRows(
        (rows) => setSavedRowTags(rows, bookmarkUri, tags),
        true
      );

      try {
        if (!demoMode) {
          if (!repo) throw new Error("Sign In to Update Tags");
          const updated = await repo.setBookmarkTags(bookmarkUri, tags);
          patchRows(
            (rows) =>
              rows.map((row) =>
                row.rec.uri === bookmarkUri
                  ? { ...row, rec: updated }
                  : row
              ),
            true
          );
        }
        await queryClient.invalidateQueries({
          queryKey: ["bookmark-tags", did],
        });
      } catch (error) {
        restoreQueries(previous);
        throw error;
      }
    },
    [cachedQueries, demoMode, did, patchRows, queryClient, repo, restoreQueries]
  );

  return {
    setItemState,
    setItemTags,
    unsave,
    canMutate: !!session && (demoMode || !!repo),
  };
}
