"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  mergeSavedItemOgPreview,
  resolveSubjectPreview,
  type ResolvedPreview,
} from "@/lib/resolveSubject";
import type { LatrRepo, RepoRecord } from "@/lib/latrRepo";
import type { SavedItemRecord, SavedItemState } from "@/lib/latrRecords";
import { rkeyFromAtUri } from "@/lib/rkey";

export type SavedRow = {
  rec: RepoRecord<SavedItemRecord>;
  preview: ResolvedPreview;
};

async function buildLibrary(
  repo: LatrRepo
): Promise<SavedRow[]> {
  const items = await repo.listSavedItems();
  const rows: SavedRow[] = await Promise.all(
    items.map(async (rec) => {
      const base = await resolveSubjectPreview(repo, rec.value.subjectUri);
      return {
        rec,
        preview: mergeSavedItemOgPreview(base, rec.value),
      };
    })
  );
  rows.sort(
    (a, b) =>
      new Date(b.rec.value.savedAt).getTime() -
      new Date(a.rec.value.savedAt).getTime()
  );
  return rows;
}

export function useSavedLibrary() {
  const repo = useLatrRepo();
  const { session } = useAuth();

  return useQuery({
    queryKey: ["saved-library", session?.did],
    queryFn: () => buildLibrary(repo!),
    enabled: !!repo && !!session,
  });
}

export function useInvalidateSavedLibrary() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: ["saved-library", session?.did],
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
  const queryKey = savedLibraryQueryKey(session?.did);

  const patchRows = useCallback(
    (updater: (rows: SavedRow[]) => SavedRow[]) => {
      queryClient.setQueryData<SavedRow[]>(queryKey, (rows) => {
        if (!rows) return rows;
        return updater(rows);
      });
    },
    [queryClient, queryKey]
  );

  const setItemState = useCallback(
    async (itemRkey: string, state: SavedItemState) => {
      if (!repo) throw new Error("Sign in to update saved items");

      const previous = queryClient.getQueryData<SavedRow[]>(queryKey);
      patchRows((rows) =>
        rows.map((row) => {
          if (rkeyFromAtUri(row.rec.uri) !== itemRkey) return row;
          return {
            ...row,
            rec: {
              ...row.rec,
              value: { ...row.rec.value, state },
            },
          };
        })
      );

      try {
        await repo.setItemState(itemRkey, state);
      } catch (error) {
        if (previous !== undefined) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw error;
      }
    },
    [patchRows, queryClient, queryKey, repo]
  );

  const unsave = useCallback(
    async (itemRkey: string) => {
      if (!repo) throw new Error("Sign in to remove saved items");

      const previous = queryClient.getQueryData<SavedRow[]>(queryKey);
      patchRows((rows) =>
        rows.filter((row) => rkeyFromAtUri(row.rec.uri) !== itemRkey)
      );

      try {
        await repo.unsave(itemRkey);
      } catch (error) {
        if (previous !== undefined) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw error;
      }
    },
    [patchRows, queryClient, queryKey, repo]
  );

  return {
    setItemState,
    unsave,
    canMutate: !!repo && !!session,
  };
}
