import { describe, expect, test } from "bun:test";

import { createDemoSavedRows, removeSavedRow, setSavedRowState } from "./demoLibrary";
import {
  flattenSavedLibraryPages,
  patchSavedLibraryPages,
  prependSavedRow,
  type SavedLibraryData,
} from "./savedLibraryPages";
import { rkeyFromAtUri } from "./rkey";

function pagedData(pageSizes: number[], lastCursor: string | null = null): SavedLibraryData {
  const rows = createDemoSavedRows();
  const pages = [];
  const pageParams: (string | null)[] = [];
  let offset = 0;
  for (let i = 0; i < pageSizes.length; i += 1) {
    const pageRows = rows.slice(offset, offset + pageSizes[i]);
    offset += pageSizes[i];
    const isLast = i === pageSizes.length - 1;
    pages.push({ rows: pageRows, cursor: isLast ? lastCursor : `cursor-${i + 1}` });
    pageParams.push(i === 0 ? null : `cursor-${i}`);
  }
  return { pages, pageParams };
}

describe("Saved Library Page Helpers", () => {
  test("flatten concatenates pages sorted by savedAt descending", () => {
    const data = pagedData([2, 2, 1]);
    const rows = flattenSavedLibraryPages(data);

    expect(rows).toHaveLength(5);
    const times = rows!.map((row) => new Date(row.rec.value.savedAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("flatten dedupes rows repeated across pages by record uri", () => {
    const data = pagedData([2, 2]);
    data.pages[1].rows = [data.pages[0].rows[0], ...data.pages[1].rows];
    const rows = flattenSavedLibraryPages(data);

    const uris = rows!.map((row) => row.rec.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  test("flatten returns undefined for missing data", () => {
    expect(flattenSavedLibraryPages(undefined)).toBeUndefined();
  });

  test("patch applies row updater in later pages while preserving cursors", () => {
    const data = pagedData([2, 2, 1]);
    const target = data.pages[1].rows[0];
    const rkey = rkeyFromAtUri(target.rec.uri);

    const patched = patchSavedLibraryPages(data, (rows) =>
      setSavedRowState(rows, rkey, "archived", "2026-08-04T00:00:00.000Z")
    );

    expect(patched!.pages.map((page) => page.cursor)).toEqual(
      data.pages.map((page) => page.cursor)
    );
    expect(patched!.pageParams).toEqual(data.pageParams);
    expect(patched!.pages[1].rows[0].rec.value.state).toBe("archived");
    expect(data.pages[1].rows[0].rec.value.state).not.toBe("archived");
  });

  test("patch removes a row from its page only", () => {
    const data = pagedData([2, 2]);
    const target = data.pages[1].rows[1];
    const rkey = rkeyFromAtUri(target.rec.uri);

    const patched = patchSavedLibraryPages(data, (rows) =>
      removeSavedRow(rows, rkey)
    );

    expect(patched!.pages[0].rows).toHaveLength(2);
    expect(patched!.pages[1].rows).toHaveLength(1);
  });

  test("patch passes undefined data through", () => {
    expect(patchSavedLibraryPages(undefined, (rows) => rows)).toBeUndefined();
  });

  test("prepend inserts into the first page of existing data", () => {
    const data = pagedData([2, 2]);
    const [row] = createDemoSavedRows();
    const next = prependSavedRow(data, row);

    expect(next.pages[0].rows[0]).toBe(row);
    expect(next.pages[0].rows).toHaveLength(3);
    expect(next.pages[1]).toBe(data.pages[1]);
  });

  test("prepend synthesizes a terminal single page when data is empty", () => {
    const [row] = createDemoSavedRows();
    const next = prependSavedRow(undefined, row);

    expect(next.pages).toHaveLength(1);
    expect(next.pages[0].rows).toEqual([row]);
    expect(next.pages[0].cursor).toBeNull();
    expect(next.pageParams).toEqual([null]);
  });

  test("a short page with a cursor still reports more pages", () => {
    const data = pagedData([2, 0], "cursor-more");
    expect(data.pages[1].rows).toHaveLength(0);
    const lastPage = data.pages[data.pages.length - 1];
    expect(lastPage.cursor ?? undefined).toBe("cursor-more");

    const terminal = pagedData([2, 1], null);
    const terminalLast = terminal.pages[terminal.pages.length - 1];
    expect(terminalLast.cursor ?? undefined).toBeUndefined();
  });
});
