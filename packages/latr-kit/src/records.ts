import {
  applyOgToExternal,
  applyOgToSavedItem,
  externalNeedsOgEnrichment,
  savedItemNeedsOgEnrichment,
  type OpenGraphMetadata,
} from "./openGraph";
import type { LatrRepoClient, RepoRecord } from "./repoClient";
import { fingerprintFromNormalizedUrl, rkeyFromNormalizedUrl, rkeyFromSubjectUri } from "./rkey";
import { normalizeUrl } from "./normalize";
import {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  type SavedExternalRecord,
  type SavedItemRecord,
  type SavedItemState,
} from "./types";
import { atUriForExternal } from "./uris";

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export async function listSavedItems(
  client: LatrRepoClient,
  did: string
): Promise<RepoRecord<SavedItemRecord>[]> {
  const all: RepoRecord<SavedItemRecord>[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listRecords<SavedItemRecord>({
      repo: did,
      collection: COLLECTION_SAVED_ITEM,
      limit: 100,
      cursor,
    });
    all.push(...page.records);
    cursor = page.cursor;
  } while (cursor);
  return all;
}

export async function getExternal(
  client: LatrRepoClient,
  did: string,
  rkey: string
): Promise<RepoRecord<SavedExternalRecord> | null> {
  return client.getRecord<SavedExternalRecord>({
    repo: did,
    collection: COLLECTION_SAVED_EXTERNAL,
    rkey,
  });
}

export async function getSavedItem(
  client: LatrRepoClient,
  did: string,
  rkey: string
): Promise<RepoRecord<SavedItemRecord> | null> {
  return client.getRecord<SavedItemRecord>({
    repo: did,
    collection: COLLECTION_SAVED_ITEM,
    rkey,
  });
}

/** Ensure wrapper exists; returns rkey + at-uri for the wrapper. */
export async function ensureExternalForUrl(
  client: LatrRepoClient,
  did: string,
  url: string
): Promise<{
  normalized: string;
  externalRkey: string;
  wrapperUri: string;
}> {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    throw new Error("Invalid or unsupported URL");
  }
  const externalRkey = await rkeyFromNormalizedUrl(normalized);
  const existing = await getExternal(client, did, externalRkey);
  if (existing) {
    return {
      normalized,
      externalRkey,
      wrapperUri: existing.uri,
    };
  }

  const fingerprint = await fingerprintFromNormalizedUrl(normalized);
  const record: SavedExternalRecord = {
    $type: COLLECTION_SAVED_EXTERNAL,
    url,
    normalizedUrl: normalized,
    fingerprint,
    createdAt: new Date().toISOString(),
  };

  await client.createRecord({
    repo: did,
    collection: COLLECTION_SAVED_EXTERNAL,
    rkey: externalRkey,
    record: asRecord(record),
  });

  return {
    normalized,
    externalRkey,
    wrapperUri: atUriForExternal(did, externalRkey),
  };
}

export async function upsertSavedItem(
  client: LatrRepoClient,
  did: string,
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
    ...(options.linkedWebUrl ? { linkedWebUrl: options.linkedWebUrl } : {}),
  };

  const existing = await getSavedItem(client, did, rkey);
  if (existing) {
    const merged: SavedItemRecord = {
      ...existing.value,
      ...record,
      savedAt: existing.value.savedAt,
    };
    const res = await client.putRecord({
      repo: did,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
      record: asRecord(merged),
    });
    return { uri: res.uri, rkey };
  }

  const res = await client.createRecord({
    repo: did,
    collection: COLLECTION_SAVED_ITEM,
    rkey,
    record: asRecord(record),
  });
  return { uri: res.uri, rkey };
}

export async function enrichExternalFromOg(
  client: LatrRepoClient,
  did: string,
  externalRkey: string,
  og: OpenGraphMetadata
): Promise<void> {
  const existing = await getExternal(client, did, externalRkey);
  if (!existing || !externalNeedsOgEnrichment(existing.value)) return;

  const merged = applyOgToExternal(existing.value, og);
  if (!merged) return;

  await client.putRecord({
    repo: did,
    collection: COLLECTION_SAVED_EXTERNAL,
    rkey: externalRkey,
    record: asRecord(merged),
  });
}

export async function enrichSavedItemFromOg(
  client: LatrRepoClient,
  did: string,
  itemRkey: string,
  og: OpenGraphMetadata
): Promise<void> {
  const existing = await getSavedItem(client, did, itemRkey);
  if (!existing || !savedItemNeedsOgEnrichment(existing.value)) return;

  const merged = applyOgToSavedItem(existing.value, og);
  if (!merged) return;

  await client.putRecord({
    repo: did,
    collection: COLLECTION_SAVED_ITEM,
    rkey: itemRkey,
    record: asRecord(merged),
  });
}

export async function saveExternalUrl(
  client: LatrRepoClient,
  did: string,
  url: string,
  options: { og?: OpenGraphMetadata } = {}
): Promise<void> {
  const { normalized, externalRkey, wrapperUri } = await ensureExternalForUrl(
    client,
    did,
    url
  );
  await upsertSavedItem(client, did, wrapperUri, { state: "unread" });
  if (options.og) {
    await enrichExternalFromOg(client, did, externalRkey, options.og);
  }
}

export async function saveSubjectUri(
  client: LatrRepoClient,
  did: string,
  subjectUri: string,
  options: { linkedWebUrl?: string; og?: OpenGraphMetadata } = {}
): Promise<void> {
  const raw = options.linkedWebUrl?.trim();
  const normalizedLink = raw ? normalizeUrl(raw) ?? raw : undefined;
  await upsertSavedItem(client, did, subjectUri, {
    state: "unread",
    ...(normalizedLink ? { linkedWebUrl: normalizedLink } : {}),
  });

  if (normalizedLink && options.og) {
    const itemRkey = await rkeyFromSubjectUri(subjectUri);
    await enrichSavedItemFromOg(client, did, itemRkey, options.og);
  }
}

export async function setSavedItemState(
  client: LatrRepoClient,
  did: string,
  itemRkey: string,
  state: SavedItemState
): Promise<void> {
  const current = await getSavedItem(client, did, itemRkey);
  if (!current) {
    throw new Error("Saved item not found");
  }
  const next: SavedItemRecord = { ...current.value, state };
  await client.putRecord({
    repo: did,
    collection: COLLECTION_SAVED_ITEM,
    rkey: itemRkey,
    record: asRecord(next),
  });
}

/** Remove the saved-item edge only (default L@tr unsave behavior). */
export async function deleteSavedItem(
  client: LatrRepoClient,
  did: string,
  itemRkey: string
): Promise<void> {
  await client.deleteRecord({
    repo: did,
    collection: COLLECTION_SAVED_ITEM,
    rkey: itemRkey,
  });
}

/**
 * Remove a queued HTTPS save by normalized URL.
 * When `deleteWrapper` is true, also deletes the external wrapper (Social Wire style).
 */
export async function deleteExternalUrlSave(
  client: LatrRepoClient,
  did: string,
  url: string,
  options: { deleteWrapper?: boolean } = {}
): Promise<void> {
  const normalized = normalizeUrl(url.trim());
  if (!normalized) {
    throw new Error("Invalid or unsupported URL");
  }
  const externalRkey = await rkeyFromNormalizedUrl(normalized);
  const wrapperUri = atUriForExternal(did, externalRkey);
  const itemRkey = await rkeyFromSubjectUri(wrapperUri);

  try {
    await client.deleteRecord({
      repo: did,
      collection: COLLECTION_SAVED_ITEM,
      rkey: itemRkey,
    });
  } catch {
    /* best-effort: record may already be absent */
  }

  if (options.deleteWrapper) {
    try {
      await client.deleteRecord({
        repo: did,
        collection: COLLECTION_SAVED_EXTERNAL,
        rkey: externalRkey,
      });
    } catch {
      /* best-effort */
    }
  }
}
