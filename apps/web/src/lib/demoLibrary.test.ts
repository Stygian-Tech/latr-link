import { describe, expect, test } from "bun:test";

import {
  createDemoSavedRowFromPaste,
  createDemoSavedRows,
  deleteSavedRowTag,
  removeSavedRow,
  renameSavedRowTag,
  setSavedRowState,
  setSavedRowTags,
  tagCountsForSavedRows,
} from "./demoLibrary";
import { rkeyFromAtUri } from "./rkey";

describe("Demo Saved Library Fixtures", () => {
  test("Seed Data Is Article-heavy With Protocol Examples", () => {
    const rows = createDemoSavedRows();
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((row) => row.preview.kind === "external").length).toBeGreaterThan(3);
    expect(rows.some((row) => row.preview.kind === "post")).toBe(true);
    expect(rows.some((row) => row.preview.kind === "record")).toBe(true);
  });

  test("Creates a Local Row From a Pasted URL", () => {
    const row = createDemoSavedRowFromPaste("https://example.com/story", [
      "work",
    ]);
    expect(row.preview.title).toBe("Saved from example.com");
    expect(row.rec.value.subject).toBe("https://example.com/story");
    expect(row.rec.metadataRecord?.value.state).toBe("unread");
    expect(row.rec.value.tags).toEqual(["work"]);
  });

  test("Archives and Removes Rows Without Mutating Originals", () => {
    const rows = createDemoSavedRows();
    const targetRkey = rkeyFromAtUri(rows[0].rec.uri);
    const archived = setSavedRowState(rows, targetRkey, "archived");
    expect(archived[0].rec.metadataRecord?.value.state).toBe("archived");
    expect(rows[0].rec.metadataRecord?.value.state).toBe("unread");

    const removed = removeSavedRow(archived, targetRkey);
    expect(removed).toHaveLength(archived.length - 1);
    expect(removed.some((row) => rkeyFromAtUri(row.rec.uri) === targetRkey)).toBe(false);
  });

  test("edits, renames, deletes, and counts tags without changing bookmark state", () => {
    const rows = createDemoSavedRows();
    const bookmarkUri = rows[0]!.rec.uri;
    const archivedState = rows[0]!.rec.metadataRecord?.value.state;

    const replaced = setSavedRowTags(rows, bookmarkUri, ["Work", "funny videos"]);
    expect(replaced[0]!.rec.value.tags).toEqual(["Work", "funny videos"]);
    expect(rows[0]!.rec.value.tags).not.toEqual(replaced[0]!.rec.value.tags);

    const renamed = renameSavedRowTag(replaced, "Work", "funny videos");
    expect(renamed[0]!.rec.value.tags).toEqual(["funny videos"]);

    const deleted = deleteSavedRowTag(renamed, "funny videos");
    expect(deleted[0]!.rec.value.tags).toBeUndefined();
    expect(deleted[0]!.rec.metadataRecord?.value.state).toBe(archivedState);

    const counts = tagCountsForSavedRows(replaced);
    expect(counts).toContainEqual({ tag: "funny videos", count: 1 });
    expect(counts).toContainEqual({ tag: "Work", count: 1 });
  });
});
