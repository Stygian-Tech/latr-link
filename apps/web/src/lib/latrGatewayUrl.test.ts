import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
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

afterEach(restoreEnv);

describe("latrGatewayBaseUrl", () => {
  test("defaults to local gateway for local app env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "local";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(LOCAL_LATR_GATEWAY_URL);
  });

  test("uses dev Fly gateway for dev app env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "dev";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_DEV_LATR_GATEWAY_URL);
  });

  test("uses prod Fly gateway for prod app env", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "prod";
    delete process.env.NEXT_PUBLIC_LATR_GATEWAY_URL;
    expect(latrGatewayBaseUrl()).toBe(DEFAULT_PROD_LATR_GATEWAY_URL);
  });

  test("honors explicit NEXT_PUBLIC_LATR_GATEWAY_URL", () => {
    process.env.NEXT_PUBLIC_LATR_GATEWAY_URL = "https://custom.gateway.example/";
    expect(latrGatewayBaseUrl()).toBe("https://custom.gateway.example");
  });
});
