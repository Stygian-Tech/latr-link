import { describe, expect, test } from "bun:test";

import { isSupportedExtensionSaveUrl } from "./browser";

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
});
