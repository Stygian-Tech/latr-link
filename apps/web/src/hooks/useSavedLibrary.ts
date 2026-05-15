"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { useLatrRepo } from "@/hooks/useLatrRepo";
import {
  mergeSavedItemOgPreview,
  resolveSubjectPreview,
  type ResolvedPreview,
} from "@/lib/resolveSubject";
import type { LatrRepo, RepoRecord } from "@/lib/latrRepo";
import type { SavedItemRecord } from "latr-kit";

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
