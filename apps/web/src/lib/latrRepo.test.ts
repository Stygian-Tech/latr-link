import { beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { configureLatrGateway } from "latr-web-client/latrGatewayConfig";
import { LatrRepo } from "latr-web-client/latrRepo";

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
  test("listSavedItems Reads Saved Items From the Viewer PDS", async () => {
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

  test("saveExternalUrl POSTs URL Body", async () => {
    let body = "";
    const oauth = mockOAuthSession(async (_url, init) => {
      body = String(init?.body ?? "");
      return new Response(
        JSON.stringify({ ok: true, kind: "url", storage: "external" }),
        {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }
      );
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.saveExternalUrl("https://example.com/a");
    expect(JSON.parse(body)).toEqual({
      kind: "url",
      url: "https://example.com/a",
    });
  });

  test("setItemState PATCHes State Route", async () => {
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

  test("Unsave Deletes Item Route", async () => {
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

describe("Latr Gateway Base URL", () => {
  test("Re-exports Env-aware Gateway URL Resolution", async () => {
    const prev = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    const { latrGatewayBaseUrl } = await import("./latrGatewayClient");
    expect(latrGatewayBaseUrl()).toBe("http://127.0.0.1:8080");
    if (prev) process.env.NEXT_PUBLIC_LATR_GATEWAY_URL = prev;
  });
});
