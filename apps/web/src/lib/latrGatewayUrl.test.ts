import { afterEach, describe, expect, test } from "bun:test";
import { configureLatrGateway } from "latr-web-client/latrGatewayConfig";

import {
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  LOCAL_LATR_GATEWAY_URL,
  latrGatewayBaseUrl,
} from "@/lib/latrGatewayUrl";

const originalEnv = {
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  APP_ENV: process.env.APP_ENV,
  NEXT_PUBLIC_LATR_GATEWAY_URL: process.env.NEXT_PUBLIC_LATR_GATEWAY_URL,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
  if (typeof window !== "undefined") {
    delete window.__LATR_GATEWAY_BOOTSTRAP__;
  }
  configureLatrGateway({
    appEnv: "local",
    clientCredential: "",
    clientId: "",
    apiKey: "",
    testingHostname: "",
    gatewayUrl: "",
  });
});

describe("Latr Gateway Base URL", () => {
  test("Defaults to Local Gateway for Local App Env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(LOCAL_LATR_GATEWAY_URL);
  });

  test("Uses Dev Fly Gateway for Dev App Env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "dev";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_DEV_LATR_GATEWAY_URL);
  });

  test("Uses Prod Fly Gateway for Prod App Env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "prod";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_PROD_LATR_GATEWAY_URL);
  });

  test("Honors Explicit NEXT_PUBLIC_LATR_GATEWAY_URL", () => {
    process.env.NEXT_PUBLIC_LATR_GATEWAY_URL = "https://custom.gateway.example/";
    expect(latrGatewayBaseUrl()).toBe("https://custom.gateway.example");
  });
});
