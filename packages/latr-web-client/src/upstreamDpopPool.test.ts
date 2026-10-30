import { describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";
import { bookmarkUpstreamProofPlanForGatewayRequest } from "latr-packages/gateway-client";
import { createChainedUpstreamDpopProofPool } from "./upstreamDpopPool";

type Claims = Record<string, string | number>;
function session(nonce?: string) {
  const requests: Array<{ url: string; method: string }> = [];
  const claims: Claims[] = [];
  let cached: string | undefined;
  const oauth = {
    did: "did:plc:viewer",
    getTokenInfo: async () => ({ aud: "https://pds.example" }),
    getTokenSet: async () => ({ access_token: "access-token" }),
    fetchHandler: async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? "GET" });
      return new Response(null, { status: 400, headers: nonce ? { "DPoP-Nonce": nonce } : {} });
    },
    server: {
      dpopNonces: { get: async () => cached, set: async (_origin: string, value: string) => { cached = value; } },
      serverMetadata: { dpop_signing_alg_values_supported: ["ES256"] },
      dpopKey: {
        bareJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, algorithms: ["ES256"],
        createJwt: async (_header: unknown, value: Claims) => {
          claims.push(value);
          return `proof-${claims.length}`;
        },
      },
    },
  } as unknown as OAuthSession;
  return { oauth, requests, claims };
}

describe("Gateway upstream proof pools", () => {
  test("Save obtains one nonce for eleven distinct method-bound proofs", async () => {
    const { oauth, requests, claims } = session("current-nonce");
    const plan = bookmarkUpstreamProofPlanForGatewayRequest("POST", "/xrpc/link.latr.bookmarks.saveBookmark")!;
    const pool = await createChainedUpstreamDpopProofPool(oauth, [...plan.specs], { accessToken: "access-token" });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(pool.split(",")).toHaveLength(11);
    expect(new Set(claims.map((proof) => proof.jti)).size).toBe(11);
    expect(claims.map((proof) => [proof.htm, proof.htu])).toEqual([
      ...Array.from({ length: 8 }, () => ["GET", "https://pds.example/xrpc/com.atproto.repo.listRecords"]),
      ...Array.from({ length: 2 }, () => ["GET", "https://pds.example/xrpc/com.atproto.repo.getRecord"]),
      ["POST", "https://pds.example/xrpc/com.atproto.repo.applyWrites"],
    ]);
    const expectedAth = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("access-token")));
    const ath = Buffer.from(expectedAth).toString("base64url");
    expect(claims.every((proof) => proof.nonce === "current-nonce" && proof.ath === ath)).toBe(true);
  });

  test("Explicit fresh nonce avoids network while preserving unique proofs", async () => {
    const { oauth, requests, claims } = session();
    await createChainedUpstreamDpopProofPool(oauth, [{ xrpcMethod: "com.atproto.repo.applyWrites", httpMethod: "POST", count: 2 }], { pdsDpopNonce: "provided-nonce", accessToken: "access-token" });
    expect(requests).toHaveLength(0);
    expect(claims).toHaveLength(2);
    expect(claims[0].jti).not.toBe(claims[1].jti);
    expect(claims.every((proof) => proof.nonce === "provided-nonce")).toBe(true);
  });

  test("Missing nonce rejects before generating any proof", async () => {
    const { oauth, claims } = session();
    await expect(createChainedUpstreamDpopProofPool(oauth, [{ xrpcMethod: "com.atproto.repo.listRecords", httpMethod: "GET" }])).rejects.toThrow("nonce unavailable");
    expect(claims).toHaveLength(0);
  });

  test("Empty pool never contacts the PDS", async () => {
    const { oauth, requests } = session();
    expect(await createChainedUpstreamDpopProofPool(oauth, [])).toBe("");
    expect(requests).toHaveLength(0);
  });
});
