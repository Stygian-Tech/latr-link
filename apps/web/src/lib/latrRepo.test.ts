import { describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { LatrRepo } from "./latrRepo";

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

describe("LatrRepo gateway facade", () => {
  test("listSavedItems reads saved items from the viewer PDS", async () => {
    const calls: string[] = [];
    const oauth = mockOAuthSession(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(
        JSON.stringify({ records: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    const items = await repo.listSavedItems();
    expect(items).toHaveLength(0);
    expect(calls[0]).toContain("com.atproto.repo.listRecords");
  });

  test("saveExternalUrl POSTs url body", async () => {
    let body = "";
    const oauth = mockOAuthSession(async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.saveExternalUrl("https://example.com/a");
    expect(JSON.parse(body)).toEqual({
      kind: "url",
      url: "https://example.com/a",
    });
  });

  test("setItemState PATCHes state route", async () => {
    let path = "";
    const oauth = mockOAuthSession(async (url) => {
      path = url;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.setItemState("abc123", "archived");
    expect(path).toContain("/v1/latr/saves/abc123/state");
  });

  test("unsave DELETEs item route", async () => {
    let method = "";
    const oauth = mockOAuthSession(async (_url, init) => {
      method = init?.method ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.unsave("item-rkey");
    expect(method).toBe("DELETE");
  });
});

describe("latrGatewayBaseUrl", () => {
  test("re-exports env-aware gateway URL resolution", async () => {
    const prev = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    const { latrGatewayBaseUrl } = await import("./latrGatewayClient");
    expect(latrGatewayBaseUrl()).toBe("http://127.0.0.1:8080");
    if (prev) process.env.NEXT_PUBLIC_LATR_GATEWAY_URL = prev;
  });
});
