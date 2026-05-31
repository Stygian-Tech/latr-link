import { describe, expect, test } from "bun:test";

import {
  extractBskyAppProfilePostParts,
  resolvePasteForSave,
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

describe("Resolve Paste For Save", () => {
  test("Returns Subject for Direct at Uri", () => {
    expect(
      resolvePasteForSave("at://did:plc:abc/app.bsky.feed.post/rkey")
    ).toEqual({
      kind: "subject",
      subjectUri: "at://did:plc:abc/app.bsky.feed.post/rkey",
      via: "at-uri",
    });
  });

  test("Returns URL for Http Paste", () => {
    expect(resolvePasteForSave("https://example.com/article")).toEqual({
      kind: "url",
      url: "https://example.com/article",
    });
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

  test("Rejects Non-bsky Hosts", () => {
    expect(
      extractBskyAppProfilePostParts(
        new URL("https://google.com/profile/x/post/y")
      )
    ).toBeNull();
  });
});
