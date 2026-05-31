import { describe, expect, test } from "bun:test";

import { isSupportedSaveUrl } from "latr-web-client/saveCurrentUrl";

describe("Extension Save URL Guards", () => {
  test("Rejects Extension Internal Pages", () => {
    expect(
      isSupportedSaveUrl("chrome-extension://abcdefghijklmnop/popup.html")
    ).toBe(false);
  });
});
