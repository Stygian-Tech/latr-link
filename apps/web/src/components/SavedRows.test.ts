import { describe, expect, test } from "bun:test";

import { createDemoSavedRows } from "@/lib/demoLibrary";
import { activateSavedHref, savedAtShort, sortSavedRows } from "./SavedRows";

const unmodifiedClick = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe("Saved Row Dates", () => {
  test("Formats A Valid Created Time", () => {
    expect(savedAtShort("2026-08-14T12:00:00.000Z")).toBe("Aug 14, 2026");
  });

  test("Handles A Persisted Pre-Migration Row Without Created Time", () => {
    expect(savedAtShort(undefined)).toBe("Date unavailable");
  });

  test("Falls Back Safely For An Invalid Created Time", () => {
    expect(savedAtShort("not-a-date")).toBe("not-a-date");
  });
});

describe("Saved Rows Sorting", () => {
  test("Sorts Archive Rows by Archived Time Before Saved Time", () => {
    const rows = createDemoSavedRows().slice(0, 2);
    const olderSavedNewerArchived = {
      ...rows[0],
      rec: {
        ...rows[0].rec,
        value: {
          ...rows[0].rec.value,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
      local: { archivedAt: "2026-07-07T12:00:00.000Z" },
    };
    const newerSavedOlderArchived = {
      ...rows[1],
      rec: {
        ...rows[1].rec,
        value: {
          ...rows[1].rec.value,
          createdAt: "2026-07-07T13:00:00.000Z",
        },
      },
      local: { archivedAt: "2026-07-06T12:00:00.000Z" },
    };

    const sorted = sortSavedRows(
      [newerSavedOlderArchived, olderSavedNewerArchived],
      "archived"
    );

    expect(sorted[0].rec.uri).toBe(olderSavedNewerArchived.rec.uri);
  });
});

describe("Saved Row Navigation", () => {
  test("Opens an article externally instead of in the embedded reader", () => {
    const embedded: string[] = [];
    const external: string[] = [];

    activateSavedHref(
      "https://example.com/news/article",
      "Longform Article",
      (url) => embedded.push(url),
      true,
      unmodifiedClick,
      (url) => external.push(url)
    );

    expect(external).toEqual(["https://example.com/news/article"]);
    expect(embedded).toEqual([]);
  });

  test("Keeps a normal non-article HTTP click in the embedded reader", () => {
    const embedded: string[] = [];
    const external: string[] = [];

    activateSavedHref(
      "https://example.com",
      "Example",
      (url) => embedded.push(url),
      false,
      unmodifiedClick,
      (url) => external.push(url)
    );

    expect(embedded).toEqual(["https://example.com/"]);
    expect(external).toEqual([]);
  });

  test("Preserves modifier-click external navigation for non-articles", () => {
    const embedded: string[] = [];
    const external: string[] = [];

    activateSavedHref(
      "https://example.com",
      "Example",
      (url) => embedded.push(url),
      false,
      { ...unmodifiedClick, metaKey: true },
      (url) => external.push(url)
    );

    expect(external).toEqual(["https://example.com"]);
    expect(embedded).toEqual([]);
  });
});
