import {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  LEGACY_COLLECTION_SAVED_EXTERNAL,
  LEGACY_COLLECTION_SAVED_ITEM,
  isLatrExternalWrapperCollection,
  remapLegacyLatrSubjectUri,
} from "latr-packages/gateway-client";

export {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  LEGACY_COLLECTION_SAVED_EXTERNAL,
  LEGACY_COLLECTION_SAVED_ITEM,
  isLatrExternalWrapperCollection,
  remapLegacyLatrSubjectUri,
};

export type SavedItemState = "unread" | "archived";

export type RepoRecord<T> = {
  uri: string;
  cid: string;
  value: T;
};

export type SavedExternalRecord = {
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
};

export type SavedItemRecord = {
  $type: typeof COLLECTION_SAVED_ITEM;
  subjectUri: string;
  savedAt: string;
  state?: SavedItemState;
  tags?: string[];
  note?: string;
  lastOpenedAt?: string;
  linkedWebUrl?: string;
  previewTitle?: string;
  previewExcerpt?: string;
  previewSite?: string;
  previewImage?: string;
  previewAuthor?: string;
};
