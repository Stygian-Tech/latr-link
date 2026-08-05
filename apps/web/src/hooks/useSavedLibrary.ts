"use client";

import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  resolveSubjectPreviewForRow,
} from "@/lib/resolveSubject";
import type { LatrRepo } from "@/lib/latrRepo";
import type { SavedItemState } from "@/lib/latrRecords";
import { rkeyFromAtUri } from "@/lib/rkey";
import { removeCachedSubjectPreview } from "@/lib/savedPreviewCache";
import {
  createDemoSavedRows,
  removeSavedRow,
  setSavedRowState,
} from "@/lib/demoLibrary";
import { isLatrDemoDataEnabled } from "@/lib/demoMode";
import {
  flattenSavedLibraryPages,
  patchSavedLibraryPages,
  type SavedLibraryData,
  type SavedLibraryPage,
} from "@/lib/savedLibraryPages";
import type { SavedRow } from "@/lib/savedLibraryTypes";

export type { SavedRow } from "@/lib/savedLibraryTypes";

export const SAVED_LIBRARY_PAGE_SIZE = 50;

export async function buildLibraryPage(
  repo: LatrRepo,
  cursor: string | null
): Promise<SavedLibraryPage> {
  const page = await repo.listSavedItemsPage({
    limit: SAVED_LIBRARY_PAGE_SIZE,
    cursor: cursor ?? undefined,
  });
  const rows: SavedRow[] = await Promise.all(
    page.records.map(async (rec) => ({
      rec,
      preview: await resolveSubjectPreviewForRow(repo, rec),
    }))
  );
  return { rows, cursor: page.cursor };
}

export function useSavedLibrary() {
  const repo = useLatrRepo();
  const { session } = useAuth();
  const demoMode = isLatrDemoDataEnabled();

  const query = useInfiniteQuery({
    queryKey: savedLibraryQueryKey(session?.did),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }): Promise<SavedLibraryPage> =>
      demoMode
        ? Promise.resolve({ rows: createDemoSavedRows(), cursor: null })
        : buildLibraryPage(repo!, pageParam),
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
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
  };
}

export function useInvalidateSavedLibrary() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: savedLibraryQueryKey(session?.did),
    });
  };
}

function savedLibraryQueryKey(did: string | undefined) {
  return ["saved-library", did] as const;
}

export function useSavedLibraryMutations() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const repo = useLatrRepo();
  const demoMode = isLatrDemoDataEnabled();
  const queryKey = savedLibraryQueryKey(session?.did);

  const patchRows = useCallback(
    (updater: (rows: SavedRow[]) => SavedRow[]) => {
      queryClient.setQueryData<SavedLibraryData>(queryKey, (data) =>
        patchSavedLibraryPages(data, updater)
      );
    },
    [queryClient, queryKey]
  );

  const setItemState = useCallback(
    async (itemRkey: string, state: SavedItemState) => {
      if (!repo && !demoMode) throw new Error("Sign In to Update Saved Items");

      const previous = queryClient.getQueryData<SavedLibraryData>(queryKey);
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
        await repo.setItemState(itemRkey, state);
      } catch (error) {
        if (previous !== undefined) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw error;
      }
    },
    [demoMode, patchRows, queryClient, queryKey, repo]
  );

  const unsave = useCallback(
    async (itemRkey: string) => {
      if (!repo && !demoMode) throw new Error("Sign In to Remove Saved Items");

      const previous = queryClient.getQueryData<SavedLibraryData>(queryKey);
      patchRows((rows) => removeSavedRow(rows, itemRkey));

      if (demoMode) return;
      if (!repo) throw new Error("Sign In to Remove Saved Items");

      try {
        await repo.unsave(itemRkey);
        const removed = flattenSavedLibraryPages(previous)?.find(
          (row) => rkeyFromAtUri(row.rec.uri) === itemRkey
        );
        if (removed) {
          removeCachedSubjectPreview(removed.rec.value.subjectUri);
        }
      } catch (error) {
        if (previous !== undefined) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw error;
      }
    },
    [demoMode, patchRows, queryClient, queryKey, repo]
  );

  return {
    setItemState,
    unsave,
    canMutate: !!session && (demoMode || !!repo),
  };
}
