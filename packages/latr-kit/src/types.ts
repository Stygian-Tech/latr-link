/** Collection NSIDs for L@tr. */
export const COLLECTION_SAVED_EXTERNAL = "com.latr.saved.external" as const;
export const COLLECTION_SAVED_ITEM = "com.latr.saved.item" as const;

export type SavedItemState = "unread" | "archived";

export interface SavedExternalRecord {
  $type: typeof COLLECTION_SAVED_EXTERNAL;
  url: string;
  normalizedUrl: string;
  fingerprint: string;
  createdAt: string;
  title?: string;
  excerpt?: string;
  site?: string;
  image?: string;
  language?: string;
  publishedAt?: string;
  author?: string;
}

export interface SavedItemRecord {
  $type: typeof COLLECTION_SAVED_ITEM;
  subjectUri: string;
  savedAt: string;
  state?: SavedItemState;
  tags?: string[];
  note?: string;
  lastOpenedAt?: string;
  /** Canonical HTTP(S) page used for Open Graph scraping (native subjects). */
  linkedWebUrl?: string;
  previewTitle?: string;
  previewExcerpt?: string;
  previewSite?: string;
  previewImage?: string;
  previewAuthor?: string;
}
