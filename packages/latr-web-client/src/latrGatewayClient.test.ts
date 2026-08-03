import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  LATR_GATEWAY_MIGRATE_LEXICONS_PATH,
  LATR_UPSTREAM_DPOP_HEADER,
} from "latr-packages/gateway-client";

import { configureLatrGateway } from "./latrGatewayConfig";
import {
  LATR_PROXY_USER_AUTHORIZATION_HEADER,
  LATR_PROXY_USER_DPOP_HEADER,
  latrGatewayFetch,
} from "./latrGatewayClient";

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
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  resetGatewayConfig();
  if (typeof window !== "undefined") {
    delete window.__LATR_GATEWAY_BOOTSTRAP__;
  }
});

function mockOAuthSession(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  onJwtClaims?: (claims: Record<string, string | number>) => void
): OAuthSession {
  let proofCount = 0;

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
        get: async () => "cached-nonce",
      },
      dpopKey: {
        bareJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
        algorithms: ["ES256"],
        createJwt: async (_header: unknown, claims: Record<string, string | number>) => {
          proofCount += 1;
          onJwtClaims?.(claims);
          return `proof-${proofCount}`;
        },
      },
      serverMetadata: {
        dpop_signing_alg_values_supported: ["ES256"],
      },
    },
  } as unknown as OAuthSession;
}

describe("latrGatewayFetch upstream proofs", () => {
  test("GET /v1/latr/saves sends list-only upstream proofs", async () => {
    let upstreamHeader = "";

    globalThis.fetch = (async (_url, init) => {
      upstreamHeader = String(
        new Headers(init?.headers).get(LATR_UPSTREAM_DPOP_HEADER) ?? ""
      );
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

    await latrGatewayFetch(oauth, "/v1/latr/saves", { method: "GET" });

    expect(upstreamHeader.split(",")).toHaveLength(8);
  });

  test("POST /v1/latr/migrate-lexicons sends migration upstream proofs", async () => {
    let upstreamHeader = "";
    let contentType = "";
    let requestBody = "";

    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      upstreamHeader = String(headers.get(LATR_UPSTREAM_DPOP_HEADER) ?? "");
      contentType = String(headers.get("Content-Type") ?? "");
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          externalCopied: 0,
          itemsCopied: 0,
          externalDeleted: 0,
          itemsDeleted: 0,
        }),
        {
          status: 200,
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

    await latrGatewayFetch(oauth, LATR_GATEWAY_MIGRATE_LEXICONS_PATH, {
      method: "POST",
    });

    expect(upstreamHeader).toBe("");
    expect(contentType).toBe("application/json");
    const body = JSON.parse(requestBody) as { upstreamDpopProof: string };
    expect(body.upstreamDpopProof.split(",")).toHaveLength(32);
  });

  test("POST /v1/latr/saves sends save upstream proofs", async () => {
    let upstreamHeader = "";

    globalThis.fetch = (async (_url, init) => {
      upstreamHeader = String(
        new Headers(init?.headers).get(LATR_UPSTREAM_DPOP_HEADER) ?? ""
      );
      return new Response(JSON.stringify({ ok: true, kind: "url" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const oauth = mockOAuthSession(async () => {
      return new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
        status: 400,
        headers: { "DPoP-Nonce": "fresh-pds-nonce" },
      });
    });

    await latrGatewayFetch(oauth, "/v1/latr/saves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "url", url: "https://example.com" }),
    });

    expect(upstreamHeader.split(",")).toHaveLength(8);
  });

  test("sends explicit gateway Authorization and DPoP headers", async () => {
    let authorization = "";
    let dpop = "";
    let upstreamDpop = "";
    const claimsSeen: Record<string, string | number>[] = [];

    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      authorization = headers.get("Authorization") ?? "";
      dpop = headers.get("DPoP") ?? "";
      upstreamDpop = headers.get(LATR_UPSTREAM_DPOP_HEADER) ?? "";
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const oauth = mockOAuthSession(
      async () =>
        new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
          status: 400,
          headers: { "DPoP-Nonce": "fresh-pds-nonce" },
        }),
      (claims) => claimsSeen.push(claims)
    );

    await latrGatewayFetch(oauth, "/v1/latr/og-preview?url=https://example.com", {
      method: "GET",
    });

    expect(authorization).toBe("DPoP test-access-token");
    expect(dpop).toBe("proof-1");
    expect(upstreamDpop).toBe("proof-2");
    expect(claimsSeen[0]).toMatchObject({
      htm: "GET",
      htu: "http://127.0.0.1:8080/v1/latr/og-preview",
    });
    expect(claimsSeen[1]).toMatchObject({
      htm: "GET",
      htu: "https://pds.example.test/xrpc/com.atproto.server.getSession",
      ath: expect.any(String),
      nonce: "fresh-pds-nonce",
    });
  });

  test("GET /v1/latr/discover/at-uri sends a PDS session attestation proof", async () => {
    let upstreamDpop = "";
    const claimsSeen: Record<string, string | number>[] = [];

    globalThis.fetch = (async (_url, init) => {
      upstreamDpop =
        new Headers(init?.headers).get(LATR_UPSTREAM_DPOP_HEADER) ?? "";
      return new Response(JSON.stringify({ matches: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const oauth = mockOAuthSession(
      async () =>
        new Response(JSON.stringify({ error: "Use DPoP nonce" }), {
          status: 400,
          headers: { "DPoP-Nonce": "fresh-pds-nonce" },
        }),
      (claims) => claimsSeen.push(claims)
    );

    await latrGatewayFetch(
      oauth,
      "/v1/latr/discover/at-uri?uri=at%3A%2F%2Fdid%3Aplc%3Atest%2Fapp.bsky.feed.post%2Fabc",
      { method: "GET" }
    );

    expect(upstreamDpop).toBe("proof-2");
    expect(claimsSeen[1]).toMatchObject({
      htm: "GET",
      htu: "https://pds.example.test/xrpc/com.atproto.server.getSession",
      ath: expect.any(String),
      nonce: "fresh-pds-nonce",
    });
  });

  test("uses proxy user auth headers for same-origin web gateway proxy", async () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      location: {
        origin: "https://testing.latr.link",
      },
    } as Window & typeof globalThis;
    configureLatrGateway({
      appEnv: "dev",
      gatewayUrl: "https://testing.latr.link/api/latr-gateway",
      testingHostname: "testing.latr.link",
      clientCredential: "",
      clientId: "",
      apiKey: "",
    });

    let authorization = "";
    let dpop = "";
    let proxyAuthorization = "";
    let proxyDpop = "";

    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      authorization = headers.get("Authorization") ?? "";
      dpop = headers.get("DPoP") ?? "";
      proxyAuthorization =
        headers.get(LATR_PROXY_USER_AUTHORIZATION_HEADER) ?? "";
      proxyDpop = headers.get(LATR_PROXY_USER_DPOP_HEADER) ?? "";
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

    try {
      await latrGatewayFetch(oauth, "/v1/latr/saves", { method: "GET" });
    } finally {
      globalThis.window = previousWindow;
    }

    expect(authorization).toBe("");
    expect(dpop).toBe("");
    expect(proxyAuthorization).toBe("DPoP test-access-token");
    expect(proxyDpop).toBe("proof-1");
  });
});
