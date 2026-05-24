import type { LatrRepoClient, RepoRecord } from "../repoClient";

export type FakeStore = Map<string, RepoRecord<Record<string, unknown>>>;

function storeKey(collection: string, rkey: string): string {
  return `${collection}:${rkey}`;
}

export function createFakeRepoClient(initial: FakeStore = new Map()): {
  client: LatrRepoClient;
  store: FakeStore;
} {
  const store = initial;

  const client: LatrRepoClient = {
    async listRecords<T>(params: {
      repo: string;
      collection: string;
      limit?: number;
      cursor?: string;
    }) {
      const prefix = `${params.collection}:`;
      const all = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v as RepoRecord<T>);

      const start = params.cursor ? Number.parseInt(params.cursor, 10) : 0;
      const limit = params.limit ?? 100;
      const page = all.slice(start, start + limit);
      const next = start + limit < all.length ? String(start + limit) : undefined;
      return { records: page, cursor: next };
    },

    async getRecord<T>(params: {
      repo: string;
      collection: string;
      rkey: string;
    }) {
      const rec = store.get(storeKey(params.collection, params.rkey));
      return (rec as RepoRecord<T> | undefined) ?? null;
    },

    async createRecord(params) {
      const uri = `at://${params.repo}/${params.collection}/${params.rkey}`;
      store.set(storeKey(params.collection, params.rkey), {
        uri,
        cid: "bafytest",
        value: params.record,
      });
      return { uri };
    },

    async putRecord(params) {
      const uri = `at://${params.repo}/${params.collection}/${params.rkey}`;
      store.set(storeKey(params.collection, params.rkey), {
        uri,
        cid: "bafytest",
        value: params.record,
      });
      return { uri };
    },

    async deleteRecord(params) {
      store.delete(storeKey(params.collection, params.rkey));
    },
  };

  return { client, store };
}
