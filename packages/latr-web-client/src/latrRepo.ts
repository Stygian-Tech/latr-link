import type { OAuthSession } from "@atproto/oauth-client-browser";
import { Agent } from "@atproto/api";
import { AtUri } from "@atproto/syntax";
import {
  LATR_XRPC,
  latrXrpcPath,
  type LatrBookmarkView,
  type LatrListBookmarksOutput,
  type LatrMigrationResult,
} from "latr-packages/gateway-client";

import {
  isLexiconMigrationComplete,
  markLexiconMigrationComplete,
} from "./lexiconMigrationCache";
import { latrGatewayJson } from "./latrGatewayClient";
import type { SavedItemState } from "./latrRecords";

export type { RepoRecord } from "./latrRecords";

export type OpenGraphPreviewFields = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
};

export type SavedItemsPage = {
  records: LatrBookmarkView[];
  cursor: string | null;
};

export type SaveUrlResponse = {
  ok: true;
  kind: "bookmark";
  bookmark: LatrBookmarkView;
};

export class LatrRepo {
  private readAgent: Agent;

  constructor(
    private oauthSession: OAuthSession,
    readonly did: string
  ) {
    this.readAgent = new Agent(oauthSession);
  }

  async listSavedItems(): Promise<LatrBookmarkView[]> {
    await this.migrateLegacyLexiconsIfNeeded();
    await this.syncBookmarkMetadataBestEffort();
    const response = await latrGatewayJson<LatrListBookmarksOutput>(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.listBookmarks),
      { method: "GET" }
    );
    return response.bookmarks ?? [];
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
    await this.syncBookmarkMetadataBestEffort(options);
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (options.cursor) params.set("cursor", options.cursor);
    const response = await latrGatewayJson<LatrListBookmarksOutput>(this.oauthSession, `${latrXrpcPath(LATR_XRPC.listBookmarks)}?${params.toString()}`, {
      method: "GET",
    });
    return { records: response.bookmarks ?? [], cursor: response.cursor ?? null };
  }

  private async syncBookmarkMetadataBestEffort(options: {
    limit?: number;
    cursor?: string;
  } = {}): Promise<void> {
    try {
      await latrGatewayJson(
        this.oauthSession,
        latrXrpcPath(LATR_XRPC.syncBookmarkMetadata),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(options.limit === undefined ? {} : { limit: options.limit }),
            ...(options.cursor ? { cursor: options.cursor } : {}),
          }),
        }
      );
    } catch {
      // Best-effort: community bookmarks remain visible and default to unread.
      // Retry every page refresh because other clients can add bookmarks later.
    }
  }

  /** One-time legacy `com.latr.*` → `link.latr.*` migration (retries until complete). */
  private async migrateLegacyLexiconsIfNeeded(): Promise<void> {
    if (isLexiconMigrationComplete(this.did)) return;

    const maxAttempts = 8;
    let cursor: string | undefined;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const summary = await latrGatewayJson<LatrMigrationResult>(
          this.oauthSession,
          latrXrpcPath(LATR_XRPC.migrateBookmarks),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 25, ...(cursor ? { cursor } : {}) }) }
        );
        if (!summary.cursor) {
          markLexiconMigrationComplete(this.did);
          return;
        }
        cursor = summary.cursor;
      }
    } catch {
      // Best-effort: still list saves if migration fails (stale proofs, offline, etc.).
    }
  }

  async saveExternalUrl(url: string): Promise<SaveUrlResponse> {
    return this.saveUrl(url);
  }

  async saveUrl(url: string): Promise<SaveUrlResponse> {
    const bookmark = await latrGatewayJson<LatrBookmarkView>(this.oauthSession, latrXrpcPath(LATR_XRPC.saveBookmark), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: url.trim() }),
    });
    return { ok: true, kind: "bookmark", bookmark };
  }

  async saveSubjectUri(
    subjectUri: string,
    options: { linkedWebUrl?: string } = {}
  ): Promise<SaveUrlResponse> {
    new AtUri(subjectUri);
    const bookmark = await latrGatewayJson<LatrBookmarkView>(this.oauthSession, latrXrpcPath(LATR_XRPC.saveBookmark), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subjectUri }),
    });
    return { ok: true, kind: "bookmark", bookmark };
  }

  async setItemState(
    bookmarkUri: string,
    state: SavedItemState
  ): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.setBookmarkState),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkUri, state }),
      }
    );
  }

  async unsave(bookmarkUri: string): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      latrXrpcPath(LATR_XRPC.deleteBookmark),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookmarkUri }) }
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
