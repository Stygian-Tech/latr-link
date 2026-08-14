import type { InfiniteData } from "@tanstack/react-query";

import type { SavedRow } from "@/lib/savedLibraryTypes";

export type SavedLibraryPage = {
  rows: SavedRow[];
  cursor: string | null;
};

export type SavedLibraryData = InfiniteData<SavedLibraryPage>;

/**
 * Flattens loaded pages into the flat `SavedRow[]` the rest of the app
 * consumes, deduped by record URI (a row can shift pages between a mutation
 * and refetch) and sorted by bookmark `createdAt` descending.
 */
export function flattenSavedLibraryPages(
  data: SavedLibraryData | undefined
): SavedRow[] | undefined {
  if (!data) return undefined;
  const seen = new Set<string>();
  const rows: SavedRow[] = [];
  for (const page of data.pages) {
    for (const row of page.rows) {
      if (seen.has(row.rec.uri)) continue;
      seen.add(row.rec.uri);
      rows.push(row);
    }
  }
  rows.sort(
    (a, b) =>
      new Date(b.rec.value.createdAt).getTime() -
      new Date(a.rec.value.createdAt).getTime()
  );
  return rows;
}

/** Applies a flat-row updater to every loaded page, preserving cursors. */
export function patchSavedLibraryPages(
  data: SavedLibraryData | undefined,
  updater: (rows: SavedRow[]) => SavedRow[]
): SavedLibraryData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, rows: updater(page.rows) })),
  };
}

/** Inserts a new row at the top of the first page, synthesizing one if empty. */
export function prependSavedRow(
  data: SavedLibraryData | undefined,
  row: SavedRow
): SavedLibraryData {
  if (!data || data.pages.length === 0) {
    return {
      pages: [{ rows: [row], cursor: null }],
      pageParams: [null],
    };
  }
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [{ ...first, rows: [row, ...first.rows] }, ...rest],
  };
}
