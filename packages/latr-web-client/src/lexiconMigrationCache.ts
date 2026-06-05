const STORAGE_PREFIX = "latr.lexicon-migration.v1.";

/** In-memory fallback when localStorage is unavailable (SSR, some test runtimes). */
const memoryComplete = new Set<string>();

function storageKey(did: string): string {
  return `${STORAGE_PREFIX}${did}`;
}

/** True after a no-op legacy lexicon migration for this DID. */
export function isLexiconMigrationComplete(did: string): boolean {
  if (memoryComplete.has(did)) return true;
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(storageKey(did)) === "1";
  } catch {
    return false;
  }
}

/** Persist no-op migration so routine library loads skip POST /migrate-lexicons. */
export function markLexiconMigrationComplete(did: string): void {
  memoryComplete.add(did);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(did), "1");
  } catch {
    // Private mode / quota — in-memory flag still applies for this session.
  }
}

/** Test helper — clears migration skip state. */
export function clearLexiconMigrationCacheForTests(): void {
  memoryComplete.clear();
  if (typeof localStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}
