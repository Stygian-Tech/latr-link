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
  test("listSavedItems migrates, synchronizes metadata, then reads saved items", async () => {
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
          call.startsWith("POST") &&
          call.includes("127.0.0.1:8080/xrpc/link.latr.bookmarks.syncMetadata")
      )
    ).toBe(true);
    expect(
      calls.some(
        (call) =>
          call.startsWith("GET") &&
          call.includes("127.0.0.1:8080/xrpc/link.latr.bookmarks.listBookmarks")
      )
    ).toBe(true);
    const migrationIndex = calls.findIndex((call) => call.includes("/xrpc/link.latr.bookmarks.migrateLegacy"));
    const syncIndex = calls.findIndex((call) => call.includes("/xrpc/link.latr.bookmarks.syncMetadata"));
    const listIndex = calls.findIndex((call) => call.includes("/xrpc/link.latr.bookmarks.listBookmarks"));
    expect(migrationIndex).toBeLessThan(syncIndex);
    expect(syncIndex).toBeLessThan(listIndex);
  });

  test("listSavedItems skips migrate when lexicon migration already completed", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({ bookmarks: [] }),
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
      calls.some((call) => call.includes("/xrpc/link.latr.bookmarks.migrateLegacy"))
    ).toBe(false);
    expect(
      calls.some((call) => call.includes("/xrpc/link.latr.bookmarks.listBookmarks"))
    ).toBe(true);
  });

  test("listSavedItemsPage sends limit and returns cursor", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({ bookmarks: [], cursor: "next-cursor" }),
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
    const saves = calls.find((call) => call.includes("/xrpc/link.latr.bookmarks.listBookmarks"));
    expect(saves).toContain("?limit=50");
    expect(saves).not.toContain("cursor=");
    const sync = calls.find((call) => call.includes("/xrpc/link.latr.bookmarks.syncMetadata"));
    expect(sync).toBeDefined();
  });

  test("listSavedItemsPage propagates URL-encoded cursor and terminates on absence", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    const syncBodies: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/xrpc/link.latr.bookmarks.syncMetadata")) {
        syncBodies.push(String(init?.body ?? ""));
      }
      return new Response(JSON.stringify({ bookmarks: [] }), {
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
    const saves = calls.find((call) => call.includes("/xrpc/link.latr.bookmarks.listBookmarks"));
    expect(saves).toContain("limit=25");
    expect(saves).toContain(`cursor=${encodeURIComponent("3jz/f+cij=")}`);
    const syncCall = calls.find((call) => call.includes("/xrpc/link.latr.bookmarks.syncMetadata"));
    expect(syncCall).toBeDefined();
    expect(JSON.parse(syncBodies[0] ?? "{}")).toEqual({ limit: 25, cursor: "3jz/f+cij=" });
  });

  test("listSavedItemsPage preserves an exact URL-encoded tag filter", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ bookmarks: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => new Response(null, {
      status: 400,
      headers: { "DPoP-Nonce": "fresh-pds-nonce" },
    }));

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.listSavedItemsPage({ limit: 50, tag: "Café & Research" });

    const listCall = calls.find((call) => call.includes("link.latr.bookmarks.listBookmarks"));
    expect(listCall).toContain("tag=Caf%C3%A9+%26+Research");
  });

  test("tag facade pages and resumes bounded mutations", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("listTags")) {
        return new Response(JSON.stringify({
          tagCounts: [{ tag: "Research", count: 2 }],
          scanned: 100,
          cursor: "tags/f+c=",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        ok: true,
        scanned: 25,
        matched: 2,
        updated: 2,
        cursor: "v:resume/f+c=",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => new Response(null, {
      status: 400,
      headers: { "DPoP-Nonce": "fresh-pds-nonce" },
    }));
    const repo = new LatrRepo(oauth, "did:plc:viewer");

    const tags = await repo.listBookmarkTagsPage({ limit: 100, cursor: "page/f+c=" });
    const renamed = await repo.renameBookmarkTag("Research", "Reference", {
      limit: 25,
      cursor: "m:resume/f+c=",
    });
    await repo.deleteBookmarkTag("Reference", { limit: 25, cursor: renamed.cursor });

    expect(tags).toEqual({
      tagCounts: [{ tag: "Research", count: 2 }],
      scanned: 100,
      cursor: "tags/f+c=",
    });
    expect(calls[0]?.url).toContain(`cursor=${encodeURIComponent("page/f+c=")}`);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      tag: "Research",
      replacement: "Reference",
      limit: 25,
      cursor: "m:resume/f+c=",
    });
    expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({
      tag: "Reference",
      limit: 25,
      cursor: "v:resume/f+c=",
    });
  });

  test("listSavedItems still requests the bare saves path", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ bookmarks: [] }), {
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

    const saves = calls.find((call) => call.includes("/xrpc/link.latr.bookmarks.listBookmarks"));
    expect(saves).toBeDefined();
    expect(saves).not.toContain("?");
  });

  test("metadata sync and bookmark reads mint their declared upstream proof pools", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const proofHeaders: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      proofHeaders.push(headers["X-ATProto-Upstream-DPoP"] ?? "");
      return new Response(JSON.stringify({ bookmarks: [] }), {
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

    expect(proofHeaders.map((value) => value.split(",").length)).toEqual([10, 9, 10, 9]);
  });

  test("metadata sync failure does not block listing and retries on refresh", async () => {
    markLexiconMigrationComplete("did:plc:viewer");
    const calls: string[] = [];
    globalThis.fetch = (async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/xrpc/link.latr.bookmarks.syncMetadata")) {
        return new Response(JSON.stringify({ error: "UpstreamFailure" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ bookmarks: [{
        uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/external",
        cid: "cid",
        value: {
          $type: "community.lexicon.bookmarks.bookmark",
          subject: "https://example.com/external",
          createdAt: "2026-08-13T00:00:00Z",
        },
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const oauth = mockOAuthSession(async () => new Response(null, {
      status: 400,
      headers: { "DPoP-Nonce": "fresh-pds-nonce" },
    }));
    const repo = new LatrRepo(oauth, "did:plc:viewer");

    expect(await repo.listSavedItems()).toHaveLength(1);
    expect(await repo.listSavedItems()).toHaveLength(1);
    expect(calls.filter((call) => call.includes("/xrpc/link.latr.bookmarks.syncMetadata"))).toHaveLength(2);
  });

  test("saveExternalUrl POSTs URL Body", async () => {
    let body = "";
    globalThis.fetch = (async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          uri: "at://did:plc:viewer/community.lexicon.bookmarks.bookmark/1",
          cid: "cid",
          value: { $type: "community.lexicon.bookmarks.bookmark", subject: "https://example.com/x", createdAt: "2026-01-01T00:00:00Z" },
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
    await repo.saveExternalUrl("https://example.com/x", { tags: ["Research", "Read Later"] });
    expect(body).toContain('"subject":"https://example.com/x"');
    expect(body).toContain("example.com");
    expect(JSON.parse(body).tags).toEqual(["Research", "Read Later"]);
  });
});
