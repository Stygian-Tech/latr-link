import { describe, expect, it } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { configureLatrGateway } from "./gatewayConfig";
import { latrGatewayFetch } from "./gatewayClient";

describe("latrGatewayFetch", () => {
  it("attaches a fresh PDS getSession proof to developer requests", async () => {
    configureLatrGateway({ gatewayUrl: "https://api.testing.latr.link" });

    const proofClaims: Array<Record<string, unknown>> = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const nonceStore = new Map<string, string>();
    const oauthSession = {
      did: "did:plc:developer",
      getTokenInfo: async () => ({ aud: "https://pds.example" }),
      getTokenSet: async () => ({ access_token: "access-token" }),
      server: {
        dpopNonces: {
          get: async (origin: string) => nonceStore.get(origin),
          set: async (origin: string, nonce: string) => {
            nonceStore.set(origin, nonce);
          },
        },
        dpopKey: {
          bareJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
          algorithms: ["ES256"],
          createJwt: async (
            _header: Record<string, unknown>,
            claims: Record<string, unknown>
          ) => {
            proofClaims.push(claims);
            return "pds-session-proof";
          },
        },
        serverMetadata: {
          dpop_signing_alg_values_supported: ["ES256"],
        },
      },
      fetchHandler: async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith("https://pds.example/xrpc/")) {
          return new Response(null, {
            status: 200,
            headers: { "DPoP-Nonce": "fresh-pds-nonce" },
          });
        }
        return Response.json({ clients: [] });
      },
    } as unknown as OAuthSession;

    const response = await latrGatewayFetch(
      oauthSession,
      "/v1/latr/developer/clients",
      { method: "POST" }
    );

    expect(response.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("com.atproto.repo.listRecords");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[1]?.url).toBe(
      "https://api.testing.latr.link/v1/latr/developer/clients"
    );
    expect(calls[1]?.init?.method).toBe("POST");

    const gatewayHeaders = new Headers(calls[1]?.init?.headers);
    expect(gatewayHeaders.get("X-ATProto-Upstream-DPoP")).toBe(
      "pds-session-proof"
    );
    expect(proofClaims).toHaveLength(1);
    expect(proofClaims[0]).toMatchObject({
      htm: "GET",
      htu: "https://pds.example/xrpc/com.atproto.server.getSession",
      nonce: "fresh-pds-nonce",
    });
    expect(proofClaims[0]?.ath).toBeString();
  });
});
