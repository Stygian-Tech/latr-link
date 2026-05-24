import { describe, expect, test } from "bun:test";
import {
  COLLECTION_SAVED_EXTERNAL,
  COLLECTION_SAVED_ITEM,
  type SavedExternalRecord,
  type SavedItemRecord,
} from "./types";
import {
  deleteExternalUrlSave,
  deleteSavedItem,
  enrichExternalFromOg,
  ensureExternalForUrl,
  listSavedItems,
  saveExternalUrl,
  saveSubjectUri,
  setSavedItemState,
  upsertSavedItem,
} from "./records";
import { rkeyFromNormalizedUrl, rkeyFromSubjectUri } from "./rkey";
import { createFakeRepoClient } from "./test/fakeRepoClient";

const DID = "did:plc:testviewer";

describe("ensureExternalForUrl", () => {
  test("creates deterministic external wrapper once", async () => {
    const { client, store } = createFakeRepoClient();
    const first = await ensureExternalForUrl(
      client,
      DID,
      "https://Example.COM/article?utm_source=x"
    );
    const second = await ensureExternalForUrl(
      client,
      DID,
      "https://example.com/article"
    );

    expect(first.normalized).toBe("https://example.com/article");
    expect(second.wrapperUri).toBe(first.wrapperUri);
    expect(
      [...store.keys()].filter((k) =>
        k.startsWith(`${COLLECTION_SAVED_EXTERNAL}:`)
      )
    ).toHaveLength(1);
  });
});

describe("upsertSavedItem", () => {
  test("preserves savedAt on re-save", async () => {
    const { client } = createFakeRepoClient();
    const subjectUri = "at://did:plc:author/app.bsky.feed.post/abc";
    const rkey = await rkeyFromSubjectUri(subjectUri);

    await client.createRecord({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
      record: {
        $type: COLLECTION_SAVED_ITEM,
        subjectUri,
        savedAt: "2026-01-01T00:00:00.000Z",
        state: "archived",
        note: "keep",
      },
    });

    await upsertSavedItem(client, DID, subjectUri, { state: "unread" });
    const rec = await client.getRecord<SavedItemRecord>({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
    });

    expect(rec?.value.savedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(rec?.value.state).toBe("unread");
    expect(rec?.value.note).toBe("keep");
  });
});

describe("saveExternalUrl", () => {
  test("creates external wrapper and saved item with OG metadata", async () => {
    const { client, store } = createFakeRepoClient();
    await saveExternalUrl(client, DID, "https://news.example/story", {
      og: {
        title: "Story",
        description: "Lead",
        image: "https://news.example/og.png",
      },
    });

    const items = [...store.values()].filter(
      (r) => r.value.$type === COLLECTION_SAVED_ITEM
    );
    const externals = [...store.values()].filter(
      (r) => r.value.$type === COLLECTION_SAVED_EXTERNAL
    );

    expect(items).toHaveLength(1);
    expect(externals).toHaveLength(1);
    expect((externals[0].value as unknown as SavedExternalRecord).title).toBe(
      "Story"
    );
    expect((items[0].value as unknown as SavedItemRecord).state).toBe(
      "unread"
    );
  });
});

describe("saveSubjectUri", () => {
  test("stores linkedWebUrl and preview metadata", async () => {
    const { client } = createFakeRepoClient();
    const subjectUri = "at://did:plc:author/app.bsky.feed.post/xyz";
    await saveSubjectUri(client, DID, subjectUri, {
      linkedWebUrl: "https://article.example/post",
      og: {
        title: "Post page",
        image: "https://article.example/card.jpg",
      },
    });

    const rkey = await rkeyFromSubjectUri(subjectUri);
    const rec = await client.getRecord<SavedItemRecord>({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
    });

    expect(rec?.value.linkedWebUrl).toBe("https://article.example/post");
    expect(rec?.value.previewTitle).toBe("Post page");
    expect(rec?.value.previewImage).toBe("https://article.example/card.jpg");
  });
});

describe("setSavedItemState", () => {
  test("updates state on existing item", async () => {
    const { client } = createFakeRepoClient();
    const subjectUri = "at://did:plc:author/app.bsky.feed.post/state";
    await upsertSavedItem(client, DID, subjectUri, { state: "unread" });
    const rkey = await rkeyFromSubjectUri(subjectUri);
    await setSavedItemState(client, DID, rkey, "archived");

    const rec = await client.getRecord<SavedItemRecord>({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
    });
    expect(rec?.value.state).toBe("archived");
  });
});

describe("deleteSavedItem", () => {
  test("removes only the saved item edge", async () => {
    const { client, store } = createFakeRepoClient();
    await saveExternalUrl(client, DID, "https://delete.example/x");
    const externalRkey = await rkeyFromNormalizedUrl("https://delete.example/x");
    const wrapperUri = `at://${DID}/${COLLECTION_SAVED_EXTERNAL}/${externalRkey}`;
    const itemRkey = await rkeyFromSubjectUri(wrapperUri);

    await deleteSavedItem(client, DID, itemRkey);

    expect(
      store.has(`${COLLECTION_SAVED_ITEM}:${itemRkey}`)
    ).toBe(false);
    expect(
      store.has(`${COLLECTION_SAVED_EXTERNAL}:${externalRkey}`)
    ).toBe(true);
  });
});

describe("deleteExternalUrlSave", () => {
  test("can delete wrapper when deleteWrapper is true", async () => {
    const { client, store } = createFakeRepoClient();
    await saveExternalUrl(client, DID, "https://remove.example/y");
    const externalRkey = await rkeyFromNormalizedUrl(
      "https://remove.example/y"
    );

    await deleteExternalUrlSave(client, DID, "https://remove.example/y", {
      deleteWrapper: true,
    });

    expect(
      store.has(`${COLLECTION_SAVED_EXTERNAL}:${externalRkey}`)
    ).toBe(false);
  });

  test("throws on invalid URL", async () => {
    const { client } = createFakeRepoClient();
    await expect(
      deleteExternalUrlSave(client, DID, "not-a-url")
    ).rejects.toThrow("Invalid or unsupported URL");
  });
});

describe("ensureExternalForUrl errors", () => {
  test("throws on invalid URL", async () => {
    const { client } = createFakeRepoClient();
    await expect(
      ensureExternalForUrl(client, DID, "javascript:alert(1)")
    ).rejects.toThrow("Invalid or unsupported URL");
  });
});

describe("listSavedItems", () => {
  test("paginates through all saved items", async () => {
    const { client } = createFakeRepoClient();
    for (let i = 0; i < 3; i++) {
      await saveExternalUrl(client, DID, `https://page.example/${i}`);
    }
    const items = await listSavedItems(client, DID);
    expect(items).toHaveLength(3);
  });
});

describe("enrichExternalFromOg", () => {
  test("fills sparse wrapper fields", async () => {
    const { client } = createFakeRepoClient();
    await saveExternalUrl(client, DID, "https://enrich.example/a");
    const externalRkey = await rkeyFromNormalizedUrl(
      "https://enrich.example/a"
    );

    await enrichExternalFromOg(client, DID, externalRkey, {
      title: "Filled title",
      image: "https://enrich.example/og.png",
    });

    const rec = await client.getRecord<SavedExternalRecord>({
      repo: DID,
      collection: COLLECTION_SAVED_EXTERNAL,
      rkey: externalRkey,
    });
    expect(rec?.value.title).toBe("Filled title");
    expect(rec?.value.image).toBe("https://enrich.example/og.png");
  });
});

describe("saveSubjectUri state preservation", () => {
  test("preserves savedAt and note on re-save", async () => {
    const { client } = createFakeRepoClient();
    const subjectUri = "at://did:plc:author/app.bsky.feed.post/preserve";
    const rkey = await rkeyFromSubjectUri(subjectUri);

    await client.createRecord({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
      record: {
        $type: COLLECTION_SAVED_ITEM,
        subjectUri,
        savedAt: "2026-02-01T00:00:00.000Z",
        state: "archived",
        note: "keep-note",
      },
    });

    await saveSubjectUri(client, DID, subjectUri);
    const rec = await client.getRecord<SavedItemRecord>({
      repo: DID,
      collection: COLLECTION_SAVED_ITEM,
      rkey,
    });

    expect(rec?.value.savedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(rec?.value.note).toBe("keep-note");
    expect(rec?.value.state).toBe("unread");
  });
});

describe("setSavedItemState errors", () => {
  test("throws when item missing", async () => {
    const { client } = createFakeRepoClient();
    await expect(
      setSavedItemState(client, DID, "missing-rkey", "archived")
    ).rejects.toThrow("Saved item not found");
  });
});
