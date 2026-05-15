/**
 * Read-later XRPC helpers on the user’s PDS via OAuth-backed Agent.
 */
import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { AtUri } from "@atproto/syntax";
import {
  atUriForExternal,
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  fingerprintFromNormalizedUrl,
  normalizeUrl,
  rkeyFromNormalizedUrl,
  rkeyFromSubjectUri,
  type SavedExternalRecord,
  type SavedItemRecord,
} from "latr-kit";

export interface RepoRecord<T> {
  uri: string;
  cid: string;
  value: T;
}

export class LatrRepo {
  private agent: Agent;
  constructor(
    oauthSession: OAuthSession,
    readonly did: string
  ) {
    this.agent = new Agent(oauthSession);
  }

  async listSavedItems(): Promise<RepoRecord<SavedItemRecord>[]> {
    const all: RepoRecord<SavedItemRecord>[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.agent.api.com.atproto.repo.listRecords({
        repo: this.did,
        collection: COLLECTION_SAVED_ITEM,
        limit: 100,
        cursor,
      });
      all.push(
        ...(response.data.records as unknown as RepoRecord<SavedItemRecord>[])
      );
      cursor = response.data.cursor ?? undefined;
    } while (cursor);
    return all;
  }

  async getExternal(
    rkey: string
  ): Promise<RepoRecord<SavedExternalRecord> | null> {
    try {
      const res = await this.agent.api.com.atproto.repo.getRecord({
        repo: this.did,
        collection: COLLECTION_SAVED_EXTERNAL,
        rkey,
      });
      const uri = res.data.uri;
      const cid = res.data.cid;
      if (!uri || !cid) return null;
      return {
        uri,
        cid,
        value: res.data.value as unknown as SavedExternalRecord,
      };
    } catch {
      return null;
    }
  }

  /** Ensure wrapper exists; returns rkey + at-uri for the wrapper. */
  async ensureExternalForUrl(url: string): Promise<{
    normalized: string;
    externalRkey: string;
    wrapperUri: string;
  }> {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      throw new Error("Invalid or unsupported URL");
    }
    const externalRkey = await rkeyFromNormalizedUrl(normalized);
    const existing = await this.getExternal(externalRkey);
    const fingerprint = await fingerprintFromNormalizedUrl(normalized);
    if (existing) {
      return {
        normalized,
        externalRkey,
        wrapperUri: existing.uri,
      };
    }

    const record: SavedExternalRecord = {
      $type: COLLECTION_SAVED_EXTERNAL,
      url,
      normalizedUrl: normalized,
      fingerprint,
      createdAt: new Date().toISOString(),
    };

    await this.agent.api.com.atproto.repo.createRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_EXTERNAL,
      rkey: externalRkey,
      record: record as unknown as Record<string, unknown>,
    });

    return {
      normalized,
      externalRkey,
      wrapperUri: atUriForExternal(this.did, externalRkey),
    };
  }

  async upsertSavedItem(
    subjectUri: string,
    options: {
      state?: SavedItemRecord["state"];
      linkedWebUrl?: string;
    } = {}
  ): Promise<{ uri: string; rkey: string }> {
    const rkey = await rkeyFromSubjectUri(subjectUri);
    const record: SavedItemRecord = {
      $type: COLLECTION_SAVED_ITEM,
      subjectUri,
      savedAt: new Date().toISOString(),
      ...(options.state ? { state: options.state } : {}),
      ...(options.linkedWebUrl
        ? { linkedWebUrl: options.linkedWebUrl }
        : {}),
    };

    const existing = await this.getSavedItemRecord(rkey);
    if (existing) {
      const merged: SavedItemRecord = {
        ...existing.value,
        ...record,
        savedAt: existing.value.savedAt,
      };
      const res = await this.agent.api.com.atproto.repo.putRecord({
        repo: this.did,
        collection: COLLECTION_SAVED_ITEM,
        rkey,
        record: merged as unknown as Record<string, unknown>,
      });
      return { uri: res.data.uri, rkey };
    }

    const res = await this.agent.api.com.atproto.repo.createRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
      record: record as unknown as Record<string, unknown>,
    });
    return { uri: res.data.uri, rkey };
  }

  async saveExternalUrl(url: string): Promise<void> {
    const { normalized, externalRkey, wrapperUri } =
      await this.ensureExternalForUrl(url);
    await this.upsertSavedItem(wrapperUri, { state: "unread" });
    await this.maybeEnrichExternalFromOg(normalized, externalRkey);
  }

  /**
   * Fetches Open Graph metadata via same-origin `/api/og-preview` and merges sparse
   * fields on `com.latr.saved.external` (best-effort; skips when preview already populated).
   */
  async maybeEnrichExternalFromOg(
    normalizedUrl: string,
    externalRkey: string
  ): Promise<void> {
    const existing = await this.getExternal(externalRkey);
    if (!existing) return;

    const v = existing.value;
    if (v.title?.trim() && v.image?.trim()) return;

    type OgResp = {
      title?: string;
      description?: string;
      image?: string;
      siteName?: string;
      author?: string;
      error?: string;
    };

    let ogJson: OgResp;
    try {
      const qp = new URLSearchParams({ url: normalizedUrl });
      const res = await fetch(`/api/og-preview?${qp.toString()}`);
      ogJson = (await res.json()) as OgResp;
      if (!res.ok) return;
    } catch {
      return;
    }

    const merged: SavedExternalRecord = {
      ...v,
      ...(ogJson.title && !v.title?.trim()
        ? { title: ogJson.title.slice(0, 2048) }
        : {}),
      ...(ogJson.description && !v.excerpt?.trim()
        ? { excerpt: ogJson.description.slice(0, 8192) }
        : {}),
      ...(ogJson.image && !v.image?.trim() ? { image: ogJson.image } : {}),
      ...(ogJson.siteName && !v.site?.trim()
        ? { site: ogJson.siteName.slice(0, 512) }
        : {}),
      ...(ogJson.author && !v.author?.trim()
        ? { author: ogJson.author.slice(0, 512) }
        : {}),
    };

    if (
      merged.title === v.title &&
      merged.excerpt === v.excerpt &&
      merged.image === v.image &&
      merged.site === v.site &&
      merged.author === v.author
    ) {
      return;
    }

    await this.agent.api.com.atproto.repo.putRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_EXTERNAL,
      rkey: externalRkey,
      record: merged as unknown as Record<string, unknown>,
    });
  }

  /**
   * Open Graph snapshot for `com.latr.saved.item` when the user saved from a public
   * web URL (native subject). Skips fetch when preview title + image already set.
   */
  async maybeEnrichSavedItemFromOg(
    normalizedLinkedUrl: string,
    itemRkey: string
  ): Promise<void> {
    const existing = await this.getSavedItemRecord(itemRkey);
    if (!existing) return;

    const v = existing.value;
    if (v.previewTitle?.trim() && v.previewImage?.trim()) return;

    type OgResp = {
      title?: string;
      description?: string;
      image?: string;
      siteName?: string;
      author?: string;
      error?: string;
    };

    let ogJson: OgResp;
    try {
      const qp = new URLSearchParams({ url: normalizedLinkedUrl });
      const res = await fetch(`/api/og-preview?${qp.toString()}`);
      ogJson = (await res.json()) as OgResp;
      if (!res.ok) return;
    } catch {
      return;
    }

    const merged: SavedItemRecord = {
      ...v,
      ...(ogJson.title && !v.previewTitle?.trim()
        ? { previewTitle: ogJson.title.slice(0, 2048) }
        : {}),
      ...(ogJson.description && !v.previewExcerpt?.trim()
        ? { previewExcerpt: ogJson.description.slice(0, 8192) }
        : {}),
      ...(ogJson.image && !v.previewImage?.trim()
        ? { previewImage: ogJson.image }
        : {}),
      ...(ogJson.siteName && !v.previewSite?.trim()
        ? { previewSite: ogJson.siteName.slice(0, 512) }
        : {}),
      ...(ogJson.author && !v.previewAuthor?.trim()
        ? { previewAuthor: ogJson.author.slice(0, 512) }
        : {}),
    };

    if (
      merged.previewTitle === v.previewTitle &&
      merged.previewExcerpt === v.previewExcerpt &&
      merged.previewImage === v.previewImage &&
      merged.previewSite === v.previewSite &&
      merged.previewAuthor === v.previewAuthor
    ) {
      return;
    }

    await this.agent.api.com.atproto.repo.putRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_ITEM,
      rkey: itemRkey,
      record: merged as unknown as Record<string, unknown>,
    });
  }

  async saveSubjectUri(
    subjectUri: string,
    options: { linkedWebUrl?: string } = {}
  ): Promise<void> {
    new AtUri(subjectUri);
    const raw = options.linkedWebUrl?.trim();
    const normalizedLink = raw ? normalizeUrl(raw) ?? raw : undefined;
    await this.upsertSavedItem(subjectUri, {
      state: "unread",
      ...(normalizedLink ? { linkedWebUrl: normalizedLink } : {}),
    });

    if (normalizedLink) {
      const itemRkey = await rkeyFromSubjectUri(subjectUri);
      await this.maybeEnrichSavedItemFromOg(normalizedLink, itemRkey);
    }
  }

  async setItemState(
    itemRkey: string,
    state: NonNullable<SavedItemRecord["state"]>
  ): Promise<void> {
    const current = await this.agent.api.com.atproto.repo.getRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_ITEM,
      rkey: itemRkey,
    });
    const prev = current.data.value as unknown as SavedItemRecord;
    const next: SavedItemRecord = { ...prev, state };
    await this.agent.api.com.atproto.repo.putRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_ITEM,
      rkey: itemRkey,
      record: next as unknown as Record<string, unknown>,
    });
  }

  async unsave(itemRkey: string): Promise<void> {
    await this.agent.api.com.atproto.repo.deleteRecord({
      repo: this.did,
      collection: COLLECTION_SAVED_ITEM,
      rkey: itemRkey,
    });
  }

  private async getSavedItemRecord(
    rkey: string
  ): Promise<RepoRecord<SavedItemRecord> | null> {
    try {
      const res = await this.agent.api.com.atproto.repo.getRecord({
        repo: this.did,
        collection: COLLECTION_SAVED_ITEM,
        rkey,
      });
      const uri = res.data.uri;
      const cid = res.data.cid;
      if (!uri || !cid) return null;
      return {
        uri,
        cid,
        value: res.data.value as unknown as SavedItemRecord,
      };
    } catch {
      return null;
    }
  }

  /**
   * Best-effort fetch of a record by AT URI (public repos; uses session agent).
   */
  async getRecordByAtUri(
    uri: string
  ): Promise<{ uri: string; cid: string; value: unknown } | null> {
    const at = new AtUri(uri);
    if (!at.collection || !at.rkey) return null;
    try {
      const res = await this.agent.api.com.atproto.repo.getRecord({
        repo: at.hostname,
        collection: at.collection,
        rkey: at.rkey,
      });
      const uri = res.data.uri;
      const cid = res.data.cid;
      if (uri === undefined || cid === undefined) return null;
      return {
        uri,
        cid,
        value: res.data.value,
      };
    } catch {
      return null;
    }
  }
}
