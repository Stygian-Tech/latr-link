import type { OAuthSession } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { AtUri } from "@atproto/syntax";
import {
  isLexiconMigrationComplete,
  markLexiconMigrationComplete,
} from "./lexiconMigrationCache";
import { latrGatewayJson } from "./latrGatewayClient";
import type { RepoRecord, SavedItemRecord } from "./latrRecords";
import {
  LATR_XRPC,
  latrXrpcPath,
  type LatrLexiconMigrationResponse,
  type LatrListItemsResponse,
} from "./xrpcMethods";

export type { RepoRecord } from "./latrRecords";

export type OpenGraphPreviewFields = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
};

export type SavedItemsPage = {
  records: RepoRecord<SavedItemRecord>[];
  cursor: string | null;
};

export type SaveUrlResponse = {
  ok: true;
  kind: "subject" | "url";
  subjectUri?: string;
  linkedWebUrl?: string;
  storage?: "native" | "external";
};

export class LatrRepo {
  private readAgent: Agent;

  constructor(
    private oauthSession: OAuthSession,
    readonly did: string
  ) {
    this.readAgent = new Agent(oauthSession);
  }

  async listSavedItems(): Promise<RepoRecord<SavedItemRecord>[]> {
    await this.migrateLegacyLexiconsIfNeeded();
    const records: RepoRecord<SavedItemRecord>[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await latrGatewayJson<
        LatrListItemsResponse<SavedItemRecord>
      >(
        this.oauthSession,
        `${latrXrpcPath(LATR_XRPC.listItems)}?${params.toString()}`,
        { method: "GET" }
      );
      records.push(...(response.records ?? []));
      cursor = response.cursor;
    } while (cursor);
    return records;
  }

  /**
   * Fetches one bounded page of saved items. Callers must keep paging while
   * `cursor` is non-null; the gateway may return a short page that still has
   * more pages remaining.
   */
  async listSavedItemsPage(options: {
    limit: number;
    cursor?: string;
  }): Promise<SavedItemsPage> {
    await this.migrateLegacyLexiconsIfNeeded();
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (options.cursor) params.set("cursor", options.cursor);
    const response = await latrGatewayJson<
      LatrListItemsResponse<SavedItemRecord>
    >(this.oauthSession, `${latrXrpcPath(LATR_XRPC.listItems)}?${params.toString()}`, {
      method: "GET",
    });
    return { records: response.records ?? [], cursor: response.cursor ?? null };
  }

  /** One-time legacy `com.latr.*` → `link.latr.*` migration (retries until complete). */
  private async migrateLegacyLexiconsIfNeeded(): Promise<void> {
    if (isLexiconMigrationComplete(this.did)) return;

    const maxAttempts = 8;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const summary = await latrGatewayJson<LatrLexiconMigrationResponse>(
          this.oauthSession,
          latrXrpcPath(LATR_XRPC.migrateLegacy),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }
        );
        const changed =
          summary.externalCopied > 0 ||
          summary.itemsCopied > 0 ||
          summary.externalDeleted > 0 ||
          summary.itemsDeleted > 0;
        if (!changed) {
          markLexiconMigrationComplete(this.did);
          return;
        }
      }
    } catch {
      // Best-effort: still list saves if migration fails (stale proofs, offline, etc.).
    }
  }

  async saveExternalUrl(url: string): Promise<SaveUrlResponse> {
    return this.saveUrl(url);
  }

  async saveUrl(url: string): Promise<SaveUrlResponse> {
    return latrGatewayJson<SaveUrlResponse>(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.saveUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }
    );
  }

  async saveSubjectUri(
    subjectUri: string,
    options: { linkedWebUrl?: string } = {}
  ): Promise<SaveUrlResponse> {
    new AtUri(subjectUri);
    return latrGatewayJson<SaveUrlResponse>(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.saveSubject),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectUri,
          ...(options.linkedWebUrl?.trim()
            ? { linkedWebUrl: options.linkedWebUrl.trim() }
            : {}),
        }),
      }
    );
  }

  async setItemState(
    itemRkey: string,
    state: NonNullable<SavedItemRecord["state"]>
  ): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.setState),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemRkey, state }),
      }
    );
  }

  async unsave(itemRkey: string): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.deleteItem),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemRkey }),
      }
    );
  }

  /** Server-side OG scrape (same path used during external saves). */
  async fetchOpenGraphPreview(
    url: string
  ): Promise<OpenGraphPreviewFields | null> {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
      const params = new URLSearchParams({ url: trimmed });
      return await latrGatewayJson<OpenGraphPreviewFields>(
        this.oauthSession,
        `${latrXrpcPath(LATR_XRPC.getOpenGraph)}?${params.toString()}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Best-effort fetch of a record by AT URI (public repos; read-only Agent).
   */
  async getRecordByAtUri(
    uri: string
  ): Promise<{ uri: string; cid: string; value: unknown } | null> {
    const at = new AtUri(uri);
    if (!at.collection || !at.rkey) return null;
    try {
      const res = await this.readAgent.api.com.atproto.repo.getRecord({
        repo: at.hostname,
        collection: at.collection,
        rkey: at.rkey,
      });
      const recordUri = res.data.uri;
      const cid = res.data.cid;
      if (recordUri === undefined || cid === undefined) return null;
      return {
        uri: recordUri,
        cid,
        value: res.data.value,
      };
    } catch {
      return null;
    }
  }
}
