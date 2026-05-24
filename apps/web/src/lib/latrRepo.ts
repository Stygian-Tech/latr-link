/**
 * Thin gateway client for L@tr save/list/state workflows.
 * Read-only cross-repo record fetches still use OAuth Agent where needed.
 */
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { AtUri } from "@atproto/syntax";
import type { RepoRecord, SavedItemRecord } from "latr-kit";

import { latrGatewayJson } from "@/lib/latrGatewayClient";

export type { RepoRecord } from "latr-kit";

export class LatrRepo {
  private readAgent: Agent;

  constructor(
    private oauthSession: OAuthSession,
    readonly did: string
  ) {
    this.readAgent = new Agent(oauthSession);
  }

  async listSavedItems(): Promise<RepoRecord<SavedItemRecord>[]> {
    const body = await latrGatewayJson<{ records: RepoRecord<SavedItemRecord>[] }>(
      this.oauthSession,
      "/v1/latr/saves"
    );
    return body.records;
  }

  async saveExternalUrl(url: string): Promise<void> {
    await latrGatewayJson(this.oauthSession, "/v1/latr/saves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "url", url }),
    });
  }

  async saveSubjectUri(
    subjectUri: string,
    options: { linkedWebUrl?: string } = {}
  ): Promise<void> {
    new AtUri(subjectUri);
    await latrGatewayJson(this.oauthSession, "/v1/latr/saves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "subject",
        subjectUri,
        ...(options.linkedWebUrl?.trim()
          ? { linkedWebUrl: options.linkedWebUrl.trim() }
          : {}),
      }),
    });
  }

  async setItemState(
    itemRkey: string,
    state: NonNullable<SavedItemRecord["state"]>
  ): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      `/v1/latr/saves/${encodeURIComponent(itemRkey)}/state`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }
    );
  }

  async unsave(itemRkey: string): Promise<void> {
    await latrGatewayJson(
      this.oauthSession,
      `/v1/latr/saves/${encodeURIComponent(itemRkey)}`,
      { method: "DELETE" }
    );
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
