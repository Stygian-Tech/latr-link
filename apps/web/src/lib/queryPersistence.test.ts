import { describe, expect, test } from "bun:test";

import {
  clearPersistedQueryCache,
  QUERY_PERSIST_KEY,
} from "./queryPersistence";

describe("Persisted Query Cache", () => {
  test("Uses A New Cache Version For The Bookmark Schema Migration", () => {
    expect(QUERY_PERSIST_KEY).toBe("latr.link.react-query.v3");
  });

  test("Clears Current And Legacy Cache Versions", () => {
    const removed: string[] = [];
    const storage = {
      removeItem(key: string) {
        removed.push(key);
      },
    } as Storage;

    clearPersistedQueryCache(storage);

    expect(removed).toEqual([
      "latr.link.react-query.v1",
      "latr.link.react-query.v2",
      "latr.link.react-query.v3",
    ]);
  });
});
