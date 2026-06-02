import { beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { LATR_UPSTREAM_DPOP_HEADER } from "latr-packages/gateway-client";

import { configureLatrGateway } from "./latrGatewayConfig";
import { latrGatewayFetch } from "./latrGatewayClient";

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
        createJwt: async () => {
          proofCount += 1;
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
  test("GET /v1/latr/saves sends a multi-proof upstream pool", async () => {
    let upstreamHeader = "";

    const oauth = mockOAuthSession(async (_url, init) => {
      upstreamHeader = String(
        new Headers(init?.headers).get(LATR_UPSTREAM_DPOP_HEADER) ?? ""
      );
      return new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await latrGatewayFetch(oauth, "/v1/latr/saves", { method: "GET" });

    expect(upstreamHeader.split(",")).toHaveLength(16);
  });
});
