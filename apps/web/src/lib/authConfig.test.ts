import { afterEach, describe, expect, test } from "bun:test";

import {
  AT_PROTO_OAUTH_SCOPES,
  buildDefaultLocalCallbackUrl,
  hasPendingOAuthBrowserCallback,
  readOAuthCallbackParamsFromWindow,
  resolveClientId,
} from "@/lib/authConfig";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalEnv = {
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_ATPROTO_CLIENT_ID: process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID,
  NEXT_PUBLIC_ATPROTO_LOCAL: process.env.NEXT_PUBLIC_ATPROTO_LOCAL,
  NEXT_PUBLIC_LOCAL_OAUTH_CLIENT_ID:
    process.env.NEXT_PUBLIC_LOCAL_OAUTH_CLIENT_ID,
  NEXT_PUBLIC_LOCAL_REDIRECT_URI: process.env.NEXT_PUBLIC_LOCAL_REDIRECT_URI,
  NEXT_PUBLIC_OAUTH_RESPONSE_MODE: process.env.NEXT_PUBLIC_OAUTH_RESPONSE_MODE,
};

function setWindowUrl(url: string): void {
  const location = new URL(url);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location },
  });
}

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
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("local OAuth config", () => {
  test("builds a loopback client ID with a 127.0.0.1 callback for localhost", () => {
    setWindowUrl("http://localhost:3000/login?next=/library#ignored");

    const clientId = new URL(resolveClientId());

    expect(clientId.origin).toBe("http://localhost");
    expect(clientId.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/callback"
    );
    expect(clientId.searchParams.get("scope")).toBe(AT_PROTO_OAUTH_SCOPES);
  });

  test("uses the current loopback port for 127.0.0.1 callback URLs", () => {
    setWindowUrl("http://127.0.0.1:4173/somewhere");

    expect(buildDefaultLocalCallbackUrl()).toBe(
      "http://127.0.0.1:4173/callback"
    );
  });

  test("falls back to hosted metadata outside local mode", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });

    expect(resolveClientId()).toBe("https://latr.link/client-metadata.json");
  });

  test("detects fragment callback params by default", () => {
    setWindowUrl("http://127.0.0.1:3000/callback#state=s1&code=c1");

    const params = readOAuthCallbackParamsFromWindow();

    expect(params?.get("state")).toBe("s1");
    expect(params?.get("code")).toBe("c1");
    expect(hasPendingOAuthBrowserCallback()).toBe(true);
  });

  test("detects query callback params when query response mode is enabled", () => {
    process.env.NEXT_PUBLIC_OAUTH_RESPONSE_MODE = "query";
    setWindowUrl("http://127.0.0.1:3000/callback?state=s1&code=c1");

    const params = readOAuthCallbackParamsFromWindow();

    expect(params?.get("state")).toBe("s1");
    expect(params?.get("code")).toBe("c1");
  });
});
