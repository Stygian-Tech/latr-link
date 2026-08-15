export const QUERY_PERSIST_KEY = "latr.link.react-query.v3";

const LEGACY_QUERY_PERSIST_KEYS = [
  "latr.link.react-query.v1",
  "latr.link.react-query.v2",
] as const;

export function clearPersistedQueryCache(storage: Storage): void {
  for (const key of [...LEGACY_QUERY_PERSIST_KEYS, QUERY_PERSIST_KEY]) {
    storage.removeItem(key);
  }
}
