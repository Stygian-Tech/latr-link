import { afterEach, describe, expect, test } from "bun:test";

import {
  assertLatrGatewayClientCredential,
  configureLatrGateway,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  LATR_OFFICIAL_CLIENT_HEADER,
  LOCAL_LATR_GATEWAY_URL,
  latrGatewayBaseUrl,
  latrGatewayClientHeaders,
} from "./latrGatewayConfig";

afterEach(() => {
  configureLatrGateway({
    appEnv: "local",
    clientCredential: "",
    testingHostname: "",
  });
});

describe("latrGatewayBaseUrl", () => {
  test("uses testing gateway on testing.latr.link even when app env is local", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_TESTING_LATR_GATEWAY_URL);
  });

  test("uses prod gateway on latr.link even when app env is local", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_PROD_LATR_GATEWAY_URL);
  });

  test("never uses loopback gateway on non-loopback hostnames", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "my-preview.vercel.app",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_DEV_LATR_GATEWAY_URL);
  });

  test("uses loopback gateway on localhost for local app env", () => {
    configureLatrGateway({
      appEnv: "local",
      testingHostname: "127.0.0.1",
    });
    expect(latrGatewayBaseUrl()).toBe(LOCAL_LATR_GATEWAY_URL);
  });

  test("honors explicit gatewayUrl override", () => {
    configureLatrGateway({
      gatewayUrl: "https://custom.gateway.example/",
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe("https://custom.gateway.example");
  });

  test("ignores loopback gatewayUrl override on hosted hostnames", () => {
    configureLatrGateway({
      gatewayUrl: LOCAL_LATR_GATEWAY_URL,
      testingHostname: "testing.latr.link",
    });
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_TESTING_LATR_GATEWAY_URL);
  });

  test("sends official client header when credential is configured", () => {
    configureLatrGateway({ clientCredential: "dGVzdC1zZWNyZXQ=" });
    expect(latrGatewayClientHeaders()[LATR_OFFICIAL_CLIENT_HEADER]).toBe(
      "dGVzdC1zZWNyZXQ="
    );
  });

  test("assertLatrGatewayClientCredential throws for hosted gateway without credential", () => {
    configureLatrGateway({
      appEnv: "dev",
      testingHostname: "testing.latr.link",
    });
    expect(() => assertLatrGatewayClientCredential()).toThrow(/official client credential/i);
  });

  test("assertLatrGatewayClientCredential allows loopback without credential", () => {
    configureLatrGateway({ appEnv: "local", testingHostname: "127.0.0.1" });
    expect(() => assertLatrGatewayClientCredential()).not.toThrow();
  });
});
