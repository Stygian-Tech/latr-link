import { describe, expect, test } from "bun:test";

import {
  isSupportedExtensionSaveUrl,
  openExtensionSaveSurface,
} from "./browser";

describe("Extension Save URL Guards", () => {
  test("Rejects Extension Internal Pages", () => {
    expect(
      isSupportedExtensionSaveUrl("chrome-extension://abcdefghijklmnop/popup.html")
    ).toBe(false);
  });

  test("Accepts HTTP and HTTPS pages", () => {
    expect(isSupportedExtensionSaveUrl("https://example.com/article")).toBe(true);
    expect(isSupportedExtensionSaveUrl("http://example.com/article")).toBe(true);
  });

  test("Uses the MV2 browserAction popup when available", async () => {
    const calls: string[] = [];
    await openExtensionSaveSurface({
      browserAction: { openPopup: async () => { calls.push("popup"); } },
      runtime: { getURL: (path) => `moz-extension://test${path}` },
      windows: { create: async ({ url }) => { calls.push(url); } },
    });
    expect(calls).toEqual(["popup"]);
  });

  test("Uses the MV3 action popup before the MV2 namespace", async () => {
    const calls: string[] = [];
    await openExtensionSaveSurface({
      action: { openPopup: async () => { calls.push("action"); } },
      browserAction: { openPopup: async () => { calls.push("browserAction"); } },
      runtime: { getURL: (path) => `chrome-extension://test${path}` },
      windows: { create: async ({ url }) => { calls.push(url); } },
    });
    expect(calls).toEqual(["action"]);
  });

  test("Falls back to a floating window when popup opening is unavailable", async () => {
    const calls: string[] = [];
    await openExtensionSaveSurface({
      runtime: { getURL: (path) => `moz-extension://test${path}` },
      windows: { create: async ({ url }) => { calls.push(url); } },
    });
    expect(calls).toEqual(["moz-extension://test/popup.html"]);
  });
});

test("Rejected native popup opens a sized floating window instead of a tab", async () => {
  let opened: unknown;
  await openExtensionSaveSurface({
    action: { openPopup: async () => { throw new Error("gesture expired"); } },
    runtime: { getURL: (path) => `chrome-extension://test${path}` },
    windows: { create: async (options) => { opened = options; } },
  });
  expect(opened).toEqual({ url: "chrome-extension://test/popup.html", type: "popup", width: 400, height: 560 });
});
