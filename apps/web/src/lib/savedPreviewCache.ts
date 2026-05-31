import type { SavedItemRecord } from "@/lib/latrRecords";
import type { ResolvedPreview } from "@/lib/resolveSubject";

const STORAGE_KEY = "latr.link.saved-preview.v2";

type CacheEntry = {
  fingerprint: string;
  preview: ResolvedPreview;
};

type CacheStore = Record<string, CacheEntry>;

export function previewCacheFingerprint(item: SavedItemRecord): string {
  return [
    item.previewTitle ?? "",
    item.previewImage ?? "",
    item.previewExcerpt ?? "",
    item.previewSite ?? "",
    item.previewAuthor ?? "",
    item.linkedWebUrl ?? "",
    item.savedAt,
  ].join("\0");
}

function readStore(): CacheStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CacheStore;
  } catch {
    return {};
  }
}

function writeStore(store: CacheStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    //
  }
}

export function readCachedSubjectPreview(
  subjectUri: string,
  fingerprint: string
): ResolvedPreview | null {
  const entry = readStore()[subjectUri];
  if (!entry || entry.fingerprint !== fingerprint) return null;
  return entry.preview;
}

export function writeCachedSubjectPreview(
  subjectUri: string,
  fingerprint: string,
  preview: ResolvedPreview
): void {
  const store = readStore();
  store[subjectUri] = { fingerprint, preview };
  writeStore(store);
}

export function removeCachedSubjectPreview(subjectUri: string): void {
  const store = readStore();
  if (!(subjectUri in store)) return;
  delete store[subjectUri];
  writeStore(store);
}
