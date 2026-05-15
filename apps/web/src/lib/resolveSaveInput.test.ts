import { describe, expect, test } from "bun:test";

import {
  extractBskyAppProfilePostParts,
  tryCanonicalAtUri,
  tryParseHttpUrl,
} from "./resolveSaveInput";

describe("tryCanonicalAtUri", () => {
  test("accepts canonical at uri with collection+rkey", () => {
    const u = tryCanonicalAtUri(
      "at://did:plc:abcxyz/app.bsky.feed.post/rkey12345"
    );
    expect(u).toBeTruthy();
    expect(u).toContain("did:plc:abcxyz");
  });

  test("rejects collection without rkey", () => {
    expect(tryCanonicalAtUri("at://did:plc:abc/app.bsky.feed.post")).toBeNull();
  });
});

describe("tryParseHttpUrl", () => {
  test("adds scheme when omitted", () => {
    const u = tryParseHttpUrl("example.org/path");
    expect(u?.href).toBe("https://example.org/path");
  });

  test("preserves scheme", () => {
    expect(tryParseHttpUrl("http://localhost/x")?.protocol).toBe("http:");
  });
});

describe("extractBskyAppProfilePostParts", () => {
  test("parses did-based profile URLs", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL(
          "https://bsky.app/profile/did:plc:test123/post/3jzabc"
        )
      )
    ).toEqual({ actor: "did:plc:test123", rkey: "3jzabc" });
  });

  test("parses handle-based profile URLs with encoded segments", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL(
          "https://bsky.app/profile/user.example.com/post/ABC123xyz"
        )
      )
    ).toEqual({
      actor: "user.example.com",
      rkey: "ABC123xyz",
    });
  });

  test("parses subdomain bsky URLs", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL(
          "https://staging.bsky.app/profile/foo/post/bar"
        )
      )
    ).toEqual({ actor: "foo", rkey: "bar" });
  });

  test("rejects non-bsky hosts", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL("https://google.com/profile/x/post/y")
      )
    ).toBeNull();
  });

  test("rejects wrong path shape", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL("https://bsky.app/profile/foo")
      )
    ).toBeNull();
  });
});
