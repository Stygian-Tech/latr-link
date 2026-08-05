import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { configureLatrGateway } from "./latrGatewayConfig";
import {
  clearLexiconMigrationCacheForTests,
  markLexiconMigrationComplete,
} from "./lexiconMigrationCache";
import { LatrRepo } from "./latrRepo";

const ORIGINAL_FETCH = globalThis.fetch;

function resetGatewayConfig() {
  configureLatrGateway({
    appEnv: "local",
    gatewayUrl: "http://127.0.0.1:8080",
    testingHostname: "127.0.0.1",
    clientCredential: "",
    clientId: "",
    apiKey: "",
  });
}

beforeEach(() => {
  resetGatewayConfig();
  clearLexiconMigrationCacheForTests();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  resetGatewayConfig();
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

describe("LatrRepo Gateway Facade", () => {
  test("listSavedItems migrates legacy lexicons then reads saved items", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/v1/latr/migrate-lexicons")) {
        return new Response(
          JSON.stringify({
            ok: true,
            externalCopied: 0,
            itemsCopied: 0,
            externalDeleted: 0,
            itemsDeleted: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          records: [
            {
              uri: "at://did:plc:viewer/link.latr.saved.item/item1",
              cid: "cid",
              value: {
                $type: "link.latr.saved.item",
                subjectUri:
                  "at://did:plc:viewer/link.latr.saved.external/ext1",
                savedAt: "2026-06-01T12:00:00.000Z",
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
          call.includes("127.0.0.1:8080/v1/latr/migrate-lexicons")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.startsWith("GET") &&
          call.includes("127.0.0.1:8080/v1/latr/saves")
      )
    ).toBe(true);
  });

  test("listSavedItems skips migrate when lexicon migration already completed", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({ records: [] }),
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
    await repo.listSavedItems();

    expect(
      calls.some((call) => call.includes("/v1/latr/migrate-lexicons"))
    ).toBe(false);
    expect(
      calls.some((call) => call.includes("/v1/latr/saves"))
    ).toBe(true);
  });

  test("listSavedItemsPage sends limit and returns cursor", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({ records: [], cursor: "next-cursor" }),
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
    const page = await repo.listSavedItemsPage({ limit: 50 });

    expect(page.cursor).toBe("next-cursor");
    const saves = calls.find((call) => call.includes("/v1/latr/saves"));
    expect(saves).toContain("?limit=50");
    expect(saves).not.toContain("cursor=");
  });

  test("listSavedItemsPage propagates URL-encoded cursor and terminates on absence", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ records: [] }), {
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
    const page = await repo.listSavedItemsPage({
      limit: 25,
      cursor: "3jz/f+cij=",
    });

    expect(page.cursor).toBeNull();
    const saves = calls.find((call) => call.includes("/v1/latr/saves"));
    expect(saves).toContain("limit=25");
    expect(saves).toContain(`cursor=${encodeURIComponent("3jz/f+cij=")}`);
  });

  test("listSavedItems still requests the bare saves path", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ records: [] }), {
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
    await repo.listSavedItems();

    const saves = calls.find((call) => call.includes("/v1/latr/saves"));
    expect(saves).toBeDefined();
    expect(saves).not.toContain("?");
  });

  test("paged saves GET mints one upstream proof; bare GET keeps the pool", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const proofHeaders: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      proofHeaders.push(headers["X-ATProto-Upstream-DPoP"] ?? "");
      return new Response(JSON.stringify({ records: [] }), {
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
    await repo.listSavedItemsPage({ limit: 50 });
    await repo.listSavedItems();

    const [paged, bare] = proofHeaders;
    expect(paged.split(",")).toHaveLength(1);
    expect(bare.split(",")).toHaveLength(8);
  });

  test("saveExternalUrl POSTs URL Body", async () => {
    let body = "";
    globalThis.fetch = (async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          kind: "url",
          storage: "external",
        }),
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
    await repo.saveExternalUrl("https://example.com/x");
    expect(body).toContain('"kind":"url"');
    expect(body).toContain("example.com");
  });
});
