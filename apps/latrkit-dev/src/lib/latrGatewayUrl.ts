import {
  configureLatrGateway,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
} from "@/lib/gatewayConfig";
import { getAppEnv, toLatrGatewayAppEnv } from "@/lib/environmentBanner";

export function syncLatrGatewayFromBrowser(): void {
  configureLatrGateway({
    gatewayUrl: process.env.NEXT_PUBLIC_LATR_GATEWAY_URL,
    appEnv: toLatrGatewayAppEnv(getAppEnv()),
    testingHostname:
      typeof window !== "undefined" ? window.location.hostname : undefined,
  });
}

function testingGatewayUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim();
  return configured?.replace(/\/$/, "") ?? DEFAULT_TESTING_LATR_GATEWAY_URL;
}

/** Gateway API base for OAuth metadata when the SPA host maps to a hosted gateway. */
export function inferGatewayApiBase(origin?: string): string | null {
  if (!origin) return null;
  try {
    const { hostname } = new URL(origin);
    if (hostname === "testing.latrkit.dev") {
      return testingGatewayUrl();
    }
  } catch {
    //
  }
  return null;
}
