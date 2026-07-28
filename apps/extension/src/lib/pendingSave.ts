import { isSupportedExtensionSaveUrl } from "./browser";

export const PENDING_SAVE_STORAGE_KEY = "latr.pending-save.v1";
export const PENDING_SAVE_TTL_MS = 5 * 60 * 1000;

export type PendingSave = {
  version: 1;
  url: string;
  requestedAt: number;
};

export function parsePendingSave(
  value: unknown,
  now = Date.now()
): PendingSave | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PendingSave>;
  if (
    candidate.version !== 1 ||
    typeof candidate.url !== "string" ||
    typeof candidate.requestedAt !== "number" ||
    !Number.isFinite(candidate.requestedAt) ||
    candidate.requestedAt > now ||
    now - candidate.requestedAt > PENDING_SAVE_TTL_MS ||
    !isSupportedExtensionSaveUrl(candidate.url)
  ) {
    return null;
  }
  return {
    version: 1,
    url: candidate.url.trim(),
    requestedAt: candidate.requestedAt,
  };
}

export async function queuePendingSave(
  url: string,
  requestedAt = Date.now()
): Promise<boolean> {
  if (!isSupportedExtensionSaveUrl(url)) return false;
  const pending: PendingSave = { version: 1, url: url.trim(), requestedAt };
  await browser.storage.local.set({ [PENDING_SAVE_STORAGE_KEY]: pending });
  return true;
}

export async function getPendingSave(now = Date.now()): Promise<PendingSave | null> {
  const stored = await browser.storage.local.get(PENDING_SAVE_STORAGE_KEY);
  const pending = parsePendingSave(stored[PENDING_SAVE_STORAGE_KEY], now);
  if (!pending && stored[PENDING_SAVE_STORAGE_KEY] !== undefined) {
    await browser.storage.local.remove(PENDING_SAVE_STORAGE_KEY);
  }
  return pending;
}

export async function takePendingSave(now = Date.now()): Promise<PendingSave | null> {
  const pending = await getPendingSave(now);
  if (pending) await browser.storage.local.remove(PENDING_SAVE_STORAGE_KEY);
  return pending;
}
