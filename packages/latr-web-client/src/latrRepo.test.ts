import { beforeEach, describe, expect, test } from "bun:test";
import type { OAuthSession } from "@atproto/oauth-client-browser";

import { configureLatrGateway } from "./latrGatewayConfig";
import { LatrRepo } from "./latrRepo";

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

describe("LatrRepo Gateway Facade", () => {
  test("saveExternalUrl POSTs URL Body", async () => {
    let body = "";
    const oauth = mockOAuthSession(async (_url, init) => {
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
    });

    const repo = new LatrRepo(oauth, "did:plc:viewer");
    await repo.saveExternalUrl("https://example.com/x");
    expect(body).toContain('"kind":"url"');
    expect(body).toContain("example.com");
  });
});
