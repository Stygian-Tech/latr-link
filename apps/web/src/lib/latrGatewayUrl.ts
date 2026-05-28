import {
  configureLatrGateway,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  LOCAL_LATR_GATEWAY_URL,
  latrGatewayBaseUrl as sharedLatrGatewayBaseUrl,
} from "latr-web-client/latrGatewayConfig";

import { toLatrGatewayAppEnv } from "@/lib/environmentBanner";

export {
  LOCAL_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
};

/** Push web env + current browser hostname into shared `latr-web-client` config. */
export function syncLatrGatewayFromBrowser(): void {
  let testingHostname: string | undefined;
  if (typeof window !== "undefined") {
    try {
      testingHostname = new URL(window.location.href).hostname;
    } catch {
      //
    }
  }
  configureLatrGateway({
    gatewayUrl: process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim(),
    appEnv: toLatrGatewayAppEnv(),
    testingHostname,
    clientCredential: process.env.NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL?.trim(),
  });
}

/**
 * Base URL for `services/latr-gateway` API calls.
 * Hostname mapping wins over loopback overrides; non-loopback explicit URL wins otherwise.
 */
export function latrGatewayBaseUrl(): string {
  syncLatrGatewayFromBrowser();
  return sharedLatrGatewayBaseUrl();
}

function testingGatewayUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim();
  return configured?.replace(/\/$/, "") ?? DEFAULT_TESTING_LATR_GATEWAY_URL;
}

/** Gateway API base for OAuth metadata when the SPA host maps to a hosted gateway. */
export function inferGatewayApiBase(origin?: string): string | null {
  if (origin) {
    try {
      const { hostname } = new URL(origin);
      if (hostname === "testing.latr.link") {
        return testingGatewayUrl();
      }
    } catch {
      //
    }
  }
  return null;
}
