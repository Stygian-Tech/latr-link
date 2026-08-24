import { describe, expect, test } from "bun:test";
import { latrGatewayClientHeaders } from "latr-web-client/latrGatewayConfig";

import {
  extensionGatewayConfig,
  extensionOAuthClientId,
  extensionOAuthRedirectUri,
} from "./config";

describe("Extension Configuration", () => {
  test("Builds split gateway authentication headers", () => {
    const config = extensionGatewayConfig({
      VITE_LATR_APP_ENV: "test",
      VITE_LATR_GATEWAY_CLIENT_ID: "latr-link-extension-testing",
      VITE_LATR_GATEWAY_API_KEY: "lk_test_secret",
    });

    expect(latrGatewayClientHeaders(config)).toEqual({
      "X-Latr-Client-Id": "latr-link-extension-testing",
      "X-Latr-API-Key": "lk_test_secret",
    });
  });

  test("Rejects incomplete split gateway credentials", () => {
    expect(() =>
      extensionGatewayConfig({
        VITE_LATR_GATEWAY_CLIENT_ID: "latr-link-extension-testing",
      })
    ).toThrow("Requires Both");
  });

  test("Builds a credential-free Production proxy configuration for stores", () => {
    const config = extensionGatewayConfig({
      MODE: "store",
      VITE_LATR_GATEWAY_URL: "https://api.testing.latr.link",
      VITE_LATR_GATEWAY_CLIENT_ID: "must-not-ship",
      VITE_LATR_GATEWAY_API_KEY: "must-not-ship",
    });

    expect(config).toEqual({
      gatewayUrl: "https://latr.link/api/latr-gateway",
      appEnv: "prod",
      clientId: undefined,
      apiKey: undefined,
    });
    expect(latrGatewayClientHeaders(config)).toEqual({});
  });

  test("Validates explicit OAuth endpoints", () => {
    const env = {
      VITE_ATPROTO_CLIENT_ID:
        "https://api.testing.latr.link/oauth/extension-client-metadata.json",
      VITE_ATPROTO_REDIRECT_URI:
        "https://testing.latr.link/extension/callback",
    };
    expect(extensionOAuthClientId(env)).toBe(env.VITE_ATPROTO_CLIENT_ID);
    expect(extensionOAuthRedirectUri(env)).toBe(env.VITE_ATPROTO_REDIRECT_URI);
  });

  test("Rejects OAuth redirect queries", () => {
    expect(() =>
      extensionOAuthRedirectUri({
        VITE_ATPROTO_REDIRECT_URI:
          "https://testing.latr.link/extension/callback?unexpected=1",
      })
    ).toThrow("Must Not Include a Query");
  });
});
