import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { configureLatrGateway } from "latr-web-client/latrGatewayConfig";
import { LatrRepo } from "latr-web-client/latrRepo";

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  configureLatrGateway({
    appEnv: "local",
    gatewayUrl: "http://127.0.0.1:8080",
    testingHostname: "127.0.0.1",
    clientCredential: "",
    clientId: "",
    apiKey: "",
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockOAuthSession(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): OAuthSession {
  return {
    did: "did:plc:viewer",
    fetchHandler: handler,
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
      dpopNonces: {
        get: async () => "test-pds-nonce",
      },
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

describe("Latrrepo Gateway Facade", () => {
  test("listSavedItems migrates legacy lexicons then reads saved items", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/xrpc/link.latr.bookmarks.migrateLegacy")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scanned: 0, created: 0, reused: 0, duplicates: 0,
            skippedConflict: 0, cached: 0, retired: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          bookmarks: [
            {
              uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/item1",
              cid: "cid",
              value: {
                $type: "community.lexicon.bookmarks.bookmark",
                subject: "https://example.com/article",
                createdAt: "2026-06-01T12:00:00.000Z",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    const items = await repo.listSavedItems();
    expect(items).toHaveLength(1);
    expect(
      calls.some(
        (call) =>
          call.startsWith("POST") &&
          call.includes("127.0.0.1:8080/xrpc/link.latr.bookmarks.migrateLegacy")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.startsWith("GET") &&
          call.includes("127.0.0.1:8080/xrpc/link.latr.bookmarks.listBookmarks")
      )
    ).toBe(true);
  });

  test("saveExternalUrl POSTs URL Body", async () => {
    let body = "";
    globalThis.fetch = (async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/1", cid: "cid", value: { $type: "community.lexicon.bookmarks.bookmark", subject: "https://example.com/a", createdAt: "2026-01-01T00:00:00Z" } }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.saveExternalUrl("https://example.com/a");
    expect(JSON.parse(body)).toEqual({ subject: "https://example.com/a" });
  });

  test("listSavedItemsPage sends limit and cursor and preserves returned cursor", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/xrpc/link.latr.bookmarks.migrateLegacy")) {
        return new Response(
          JSON.stringify({
            ok: true,
            scanned: 0, created: 0, reused: 0, duplicates: 0,
            skippedConflict: 0, cached: 0, retired: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ bookmarks: [], cursor: "page-2" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    const page = await repo.listSavedItemsPage({ limit: 50, cursor: "page-1" });

    expect(page.cursor).toBe("page-2");
    const saves = calls.find(
      (call) => call.startsWith("GET") && call.includes("/xrpc/link.latr.bookmarks.listBookmarks")
    );
    expect(saves).toContain("limit=50");
    expect(saves).toContain("cursor=page-1");
  });

  test("setItemState posts bookmark URI to XRPC", async () => {
    let path = "";
    globalThis.fetch = (async (url) => {
      path = String(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.setItemState("at://did:plc:viewer/community.lexicon.bookmarks.bookmark/abc123", "archived");
    expect(path).toContain("/xrpc/link.latr.bookmarks.setState");
  });

  test("Unsave posts deleteBookmark XRPC", async () => {
    let method = "";
    globalThis.fetch = (async (_url, init) => {
      method = init?.method ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.unsave("at://did:plc:viewer/community.lexicon.bookmarks.bookmark/item-rkey");
    expect(method).toBe("POST");
  });
});
