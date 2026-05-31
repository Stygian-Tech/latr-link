import { describe, expect, test } from "bun:test";

import {
  extractBskyAppProfilePostParts,
  tryCanonicalAtUri,
  tryParseHttpUrl,
} from "./resolveSaveInput";

describe("Try Canonical At URI", () => {
  test("Accepts Canonical at Uri with Collection+rkey", () => {
    const u = tryCanonicalAtUri(
      "at://did:plc:abcxyz/app.bsky.feed.post/rkey12345"
    );
    expect(u).toBeTruthy();
    expect(u).toContain("did:plc:abcxyz");
  });

  test("Rejects Collection without Rkey", () => {
    expect(tryCanonicalAtUri("at://did:plc:abc/app.bsky.feed.post")).toBeNull();
  });
});

describe("Try Parse HTTP URL", () => {
  test("Adds Scheme when Omitted", () => {
    const u = tryParseHttpUrl("example.org/path");
    expect(u?.href).toBe("https://example.org/path");
  });

  test("Preserves Scheme", () => {
    expect(tryParseHttpUrl("http://localhost/x")?.protocol).toBe("http:");
  });
});

describe("Extract Bsky App Profile Post Parts", () => {
  test("Parses Did-based Profile Urls", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL(
          "https://bsky.app/profile/did:plc:test123/post/3jzabc"
        )
      )
    ).toEqual({ actor: "did:plc:test123", rkey: "3jzabc" });
  });

  test("Parses Handle-based Profile Urls with Encoded Segments", () => {
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

  test("Parses Subdomain Bsky Urls", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL(
          "https://staging.bsky.app/profile/foo/post/bar"
        )
      )
    ).toEqual({ actor: "foo", rkey: "bar" });
  });

  test("Rejects Non-bsky Hosts", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL("https://google.com/profile/x/post/y")
      )
    ).toBeNull();
  });

  test("Rejects Wrong Path Shape", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL("https://bsky.app/profile/foo")
      )
    ).toBeNull();
  });
});
