import { articleRecordNamespaceForAtUri } from "@/lib/resolveSubject";
import type { SavedRow } from "@/lib/savedLibraryTypes";

export type SavedRowsFilter = "all" | "article" | "social" | "other";

function articleLikeUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    return parts.length > 1 || last.includes("-") || last.length > 18;
  } catch {
    return false;
  }
}

function savedRowLooksLikeArticle(row: SavedRow): boolean {
  if (articleRecordNamespaceForAtUri(row.rec.value.subject)) return true;
  if (row.preview.kind !== "external") return false;

  const title = row.preview.title.trim().toLowerCase();
  if (!title || title.startsWith("saved from ")) return false;

  return Boolean(
    row.preview.authorLabel?.trim() ||
      articleLikeUrl(row.preview.canonicalUrl || row.preview.href)
  );
}

export function savedRowContentBucket(
  row: SavedRow
): Exclude<SavedRowsFilter, "all"> {
  if (row.preview.kind === "post") return "social";
  if (savedRowLooksLikeArticle(row)) return "article";
  return "other";
}

export function filterSavedRowsByContent(
  rows: SavedRow[],
  filter: SavedRowsFilter
): SavedRow[] {
  if (filter === "all") return rows;
  return rows.filter((row) => savedRowContentBucket(row) === filter);
}
