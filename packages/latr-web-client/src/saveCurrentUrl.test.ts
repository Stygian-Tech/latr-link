import { afterEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { configureLatrGateway } from "./latrGatewayConfig";
import { isSupportedSaveUrl, saveCurrentUrl } from "./saveCurrentUrl";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureLatrGateway({
    appEnv: "local",
    gatewayUrl: "http://127.0.0.1:8080",
    clientCredential: "",
    clientId: "",
    apiKey: "",
  });
});

function mockOAuthSession(): OAuthSession {
  return {
    did: "did:plc:viewer",
    fetchHandler: async () => new Response(null, {
      status: 400,
      headers: { "DPoP-Nonce": "fresh-pds-nonce" },
    }),
    getTokenInfo: async () => ({
      aud: "https://pds.example.test",
      iss: "https://bsky.social",
      sub: "did:plc:viewer",
      scope: "atproto",
    }),
    getTokenSet: async () => ({
      access_token: "test-access-token",
      token_type: "DPoP",
    }),
    server: {
      dpopNonces: { get: async () => "test-pds-nonce" },
      dpopKey: {
        bareJwk: { kty: "EC" },
        algorithms: ["ES256"],
        createJwt: async () => "test.upstream.dpop.proof",
      },
      serverMetadata: {
        dpop_signing_alg_values_supported: ["ES256"],
      },
    },
  } as unknown as OAuthSession;
}

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

  test("sends canonical tags through the bookmark XRPC save", async () => {
    configureLatrGateway({ appEnv: "local", gatewayUrl: "http://127.0.0.1:8080" });
    let requestBody = "";
    globalThis.fetch = (async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/test",
        cid: "cid",
        value: {
          $type: "community.lexicon.bookmarks.bookmark",
          subject: "https://example.com/article",
          createdAt: "2026-08-23T00:00:00Z",
          tags: ["funny videos", "Work"],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const result = await saveCurrentUrl(
      " https://example.com/article ",
      mockOAuthSession(),
      { tags: [" funny videos ", "Work", "Work"] }
    );

    expect(result).toEqual({ ok: true, kind: "bookmark" });
    expect(JSON.parse(requestBody)).toMatchObject({
      subject: "https://example.com/article",
      tags: ["funny videos", "Work"],
    });
  });

  test("rejects invalid tags before sending a gateway request", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;

    const result = await saveCurrentUrl(
      "https://example.com/article",
      mockOAuthSession(),
      { tags: ["a".repeat(65)] }
    );

    expect(result).toEqual({
      ok: false,
      message: "Tags can contain at most 64 characters.",
    });
    expect(fetched).toBe(false);
  });
});
