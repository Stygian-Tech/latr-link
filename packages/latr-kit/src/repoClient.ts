/** ATProto repo record returned from list/get XRPC. */
export interface RepoRecord<T> {
  uri: string;
  cid: string;
  value: T;
}

export interface CreateRecordResult {
  uri: string;
}

export interface PutRecordResult {
  uri: string;
}

export interface ListRecordsPage<T> {
  records: RepoRecord<T>[];
  cursor?: string;
}

/**
 * Protocol-neutral repo client for L@tr write workflows.
 * Apps adapt OAuth-backed `@atproto/api` Agent implementations to this interface.
 */
export interface LatrRepoClient {
  listRecords<T>(params: {
    repo: string;
    collection: string;
    limit?: number;
    cursor?: string;
  }): Promise<ListRecordsPage<T>>;

  getRecord<T>(params: {
    repo: string;
    collection: string;
    rkey: string;
  }): Promise<RepoRecord<T> | null>;

  createRecord(params: {
    repo: string;
    collection: string;
    rkey: string;
    record: Record<string, unknown>;
  }): Promise<CreateRecordResult>;

  putRecord(params: {
    repo: string;
    collection: string;
    rkey: string;
    record: Record<string, unknown>;
  }): Promise<PutRecordResult>;

  deleteRecord(params: {
    repo: string;
    collection: string;
    rkey: string;
  }): Promise<void>;
}
