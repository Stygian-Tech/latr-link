import type { SavedExternalRecord, SavedItemRecord } from "./types";

/** Parsed Open Graph fields passed into kit record mappers (no HTML fetching). */
export interface OpenGraphMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}

/** Lexicon max lengths for cached OG metadata. */
export const OG_FIELD_MAX = {
  title: 2048,
  excerpt: 8192,
  site: 512,
  author: 512,
} as const;

function sliceField(value: string, max: number): string {
  return value.slice(0, max);
}

/** True when external wrapper still lacks title + image for display. */
export function externalNeedsOgEnrichment(rec: SavedExternalRecord): boolean {
  return !(rec.title?.trim() && rec.image?.trim());
}

/** True when saved item still lacks preview title + image. */
export function savedItemNeedsOgEnrichment(rec: SavedItemRecord): boolean {
  return !(rec.previewTitle?.trim() && rec.previewImage?.trim());
}

/**
 * Merge sparse OG metadata onto `com.latr.saved.external`.
 * Preserves existing non-empty fields. Returns `null` when nothing changed.
 */
export function applyOgToExternal(
  existing: SavedExternalRecord,
  og: OpenGraphMetadata
): SavedExternalRecord | null {
  const merged: SavedExternalRecord = {
    ...existing,
    ...(og.title && !existing.title?.trim()
      ? { title: sliceField(og.title, OG_FIELD_MAX.title) }
      : {}),
    ...(og.description && !existing.excerpt?.trim()
      ? { excerpt: sliceField(og.description, OG_FIELD_MAX.excerpt) }
      : {}),
    ...(og.image && !existing.image?.trim() ? { image: og.image } : {}),
    ...(og.siteName && !existing.site?.trim()
      ? { site: sliceField(og.siteName, OG_FIELD_MAX.site) }
      : {}),
    ...(og.author && !existing.author?.trim()
      ? { author: sliceField(og.author, OG_FIELD_MAX.author) }
      : {}),
  };

  if (
    merged.title === existing.title &&
    merged.excerpt === existing.excerpt &&
    merged.image === existing.image &&
    merged.site === existing.site &&
    merged.author === existing.author
  ) {
    return null;
  }

  return merged;
}

/**
 * Merge sparse OG metadata onto `com.latr.saved.item` preview fields.
 * Preserves existing non-empty fields. Returns `null` when nothing changed.
 */
export function applyOgToSavedItem(
  existing: SavedItemRecord,
  og: OpenGraphMetadata
): SavedItemRecord | null {
  const merged: SavedItemRecord = {
    ...existing,
    ...(og.title && !existing.previewTitle?.trim()
      ? { previewTitle: sliceField(og.title, OG_FIELD_MAX.title) }
      : {}),
    ...(og.description && !existing.previewExcerpt?.trim()
      ? { previewExcerpt: sliceField(og.description, OG_FIELD_MAX.excerpt) }
      : {}),
    ...(og.image && !existing.previewImage?.trim()
      ? { previewImage: og.image }
      : {}),
    ...(og.siteName && !existing.previewSite?.trim()
      ? { previewSite: sliceField(og.siteName, OG_FIELD_MAX.site) }
      : {}),
    ...(og.author && !existing.previewAuthor?.trim()
      ? { previewAuthor: sliceField(og.author, OG_FIELD_MAX.author) }
      : {}),
  };

  if (
    merged.previewTitle === existing.previewTitle &&
    merged.previewExcerpt === existing.previewExcerpt &&
    merged.previewImage === existing.previewImage &&
    merged.previewSite === existing.previewSite &&
    merged.previewAuthor === existing.previewAuthor
  ) {
    return null;
  }

  return merged;
}
