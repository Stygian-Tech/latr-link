import { afterEach, describe, expect, test } from "bun:test";

import {
  assertLatrGatewayClientCredential,
  configureLatrGateway,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  LATR_API_KEY_HEADER,
  LATR_CLIENT_ID_HEADER,
  LATR_OFFICIAL_CLIENT_HEADER,
  LOCAL_LATR_GATEWAY_URL,
  latrGatewayBaseUrl,
  latrGatewayClientHeaders,
  resolveLatrGatewayConfig,
} from "./latrGatewayConfig";

afterEach(() => {
  configureLatrGateway({
    appEnv: "local",
    clientCredential: "",
    clientId: "",
    apiKey: "",
    testingHostname: "",
    gatewayUrl: "",
  });
  if (typeof window !== "undefined") {
    delete window.__LATR_GATEWAY_BOOTSTRAP__;
  }
});

describe("Latr Gateway Base URL", () => {
  test("Uses Testing Gateway on testing.latr.link Even When App Env Is Local", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_TESTING_LATR_GATEWAY_URL);
  });

  test("Uses Prod Gateway on latr.link Even When App Env Is Local", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_PROD_LATR_GATEWAY_URL);
  });

  test("Never uses Loopback Gateway on Non-loopback Hostnames", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "my-preview.vercel.app",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_DEV_LATR_GATEWAY_URL);
  });

  test("Uses Loopback Gateway on Localhost for Local App Env", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "127.0.0.1",
    });
    expect(latrGatewayBaseUrl()).toBe(LOCAL_LATR_GATEWAY_URL);
  });

  test("Honors Explicit gatewayUrl Override", () => {
    configureLatrGateway({
      gatewayUrl: "https://custom.gateway.example/",
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe("https://custom.gateway.example");
  });

  test("Ignores Loopback gatewayUrl Override on Hosted Hostnames", () => {
    configureLatrGateway({
      gatewayUrl: LOCAL_LATR_GATEWAY_URL,
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_TESTING_LATR_GATEWAY_URL);
  });

  test("Sends Official Client Header When Credential Is Configured", () => {
    configureLatrGateway({ clientCredential: "dGVzdC1zZWNyZXQ=" });
    expect(latrGatewayClientHeaders()[LATR_OFFICIAL_CLIENT_HEADER]).toBe(
      "dGVzdC1zZWNyZXQ="
    );
  });

  test("Sends Split Developer Headers When Client ID and API Key Are Configured", () => {
    configureLatrGateway({
      clientId: "the-social-wire-web",
      apiKey: "lk_test_key",
    });
    const headers = latrGatewayClientHeaders();
    expect(headers[LATR_CLIENT_ID_HEADER]).toBe("the-social-wire-web");
    expect(headers[LATR_API_KEY_HEADER]).toBe("lk_test_key");
  });

  test("assertLatrGatewayClientCredential Throws for Hosted Gateway Without Credential", () => {
    configureLatrGateway({
      appEnv: "dev",
      testingHostname: "testing.latr.link",
    });
    expect(() => assertLatrGatewayClientCredential()).toThrow(/client credentials/i);
  });

  test("assertLatrGatewayClientCredential Allows Loopback Without Credential", () => {
    configureLatrGateway({ appEnv: "local", testingHostname: "127.0.0.1" });
    expect(() => assertLatrGatewayClientCredential()).not.toThrow();
  });

  test("resolveLatrGatewayConfig Merges Window Bootstrap Credentials", () => {
    configureLatrGateway({
      appEnv: "dev",
      testingHostname: "testing.latr.link",
      clientId: "",
      apiKey: "",
    });
    const previousWindow = globalThis.window;
    globalThis.window = {
      __LATR_GATEWAY_BOOTSTRAP__: {
        clientId: "latr-link-web",
        apiKey: "lk_test_key",
      },
    } as Window & typeof globalThis;
    try {
      expect(() => assertLatrGatewayClientCredential()).not.toThrow();
      const headers = latrGatewayClientHeaders(resolveLatrGatewayConfig());
      expect(headers[LATR_CLIENT_ID_HEADER]).toBe("latr-link-web");
      expect(headers[LATR_API_KEY_HEADER]).toBe("lk_test_key");
    } finally {
      globalThis.window = previousWindow;
    }
  });
});
