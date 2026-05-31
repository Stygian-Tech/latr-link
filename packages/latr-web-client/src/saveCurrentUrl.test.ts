import { describe, expect, test } from "bun:test";

import { isSupportedSaveUrl } from "./saveCurrentUrl";

describe("Is Supported Save URL", () => {
  test("Accepts HTTPS URLs", () => {
    expect(isSupportedSaveUrl("https://example.com/article")).toBe(true);
  });

  test("Rejects Browser-Internal URLs", () => {
    expect(isSupportedSaveUrl("chrome://newtab/")).toBe(false);
    expect(isSupportedSaveUrl("chrome-extension://abc/popup.html")).toBe(false);
  });

  test("Rejects Empty Input", () => {
    expect(isSupportedSaveUrl("")).toBe(false);
  });
});
