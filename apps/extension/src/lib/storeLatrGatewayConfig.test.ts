import { describe, expect, test } from "bun:test";

import {
  assertLatrGatewayClientCredential,
  configureLatrGateway,
  latrGatewayBaseUrl,
  latrGatewayClientHeaders,
} from "./storeLatrGatewayConfig";

describe("Store gateway configuration", () => {
  test("only permits the credential-free Production proxy", () => {
    configureLatrGateway({
      gatewayUrl: "https://latr.link/api/latr-gateway",
      appEnv: "prod",
      clientId: "ignored",
      apiKey: "ignored",
    });

    expect(latrGatewayBaseUrl()).toBe(
      "https://latr.link/api/latr-gateway"
    );
    expect(latrGatewayClientHeaders()).toEqual({});
    expect(() => assertLatrGatewayClientCredential()).not.toThrow();
  });

  test("rejects a direct or lookalike gateway", () => {
    expect(() =>
      configureLatrGateway({ gatewayUrl: "https://api.latr.link" })
    ).toThrow("only support");
    expect(() =>
      configureLatrGateway({
        gatewayUrl: "https://latr.link.evil.example/api/latr-gateway",
      })
    ).toThrow("only support");
  });
});
