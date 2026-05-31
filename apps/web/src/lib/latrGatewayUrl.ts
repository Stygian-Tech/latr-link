import {
  configureLatrGateway,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  LOCAL_LATR_GATEWAY_URL,
  latrGatewayBaseUrl as sharedLatrGatewayBaseUrl,
  publishLatrGatewayWindowBootstrap,
  registerLatrGatewayConfigSync,
  type LatrGatewayEnvConfig,
  type LatrGatewayWindowBootstrap,
} from "latr-web-client/latrGatewayConfig";

import { toLatrGatewayAppEnv } from "@/lib/environmentBanner";

export {
  LOCAL_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
};

export type { LatrGatewayWindowBootstrap };

/** Credential from the server layout (runtime env); wins over client `process.env`. */
let injectedGatewayClientCredential: string | undefined;
let injectedGatewayClientId: string | undefined;
let injectedGatewayApiKey: string | undefined;

export function setInjectedGatewayClientCredential(
  credential: string | undefined
): void {
  const trimmed = credential?.trim();
  injectedGatewayClientCredential = trimmed || undefined;
}

export function setInjectedGatewayClientCredentials(credentials: {
  clientId?: string;
  apiKey?: string;
}): void {
  const clientId = credentials.clientId?.trim();
  const apiKey = credentials.apiKey?.trim();
  injectedGatewayClientId = clientId || undefined;
  injectedGatewayApiKey = apiKey || undefined;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** Read gateway client credential on the server (layout) or from build-time env. */
export function readGatewayClientCredentialFromEnv(): string | undefined {
  return (
    readEnv("LATR_GATEWAY_CLIENT_CREDENTIAL") ??
    readEnv("NEXT_PUBLIC_LATR_GATEWAY_CLIENT_CREDENTIAL")
  );
}

/** Read split gateway credentials on the server (layout) or from build-time env. */
export function readGatewayClientCredentialsFromEnv(): {
  clientId?: string;
  apiKey?: string;
} {
  const clientId =
    readEnv("LATR_GATEWAY_CLIENT_ID") ??
    readEnv("NEXT_PUBLIC_LATR_GATEWAY_CLIENT_ID");
  const apiKey =
    readEnv("LATR_GATEWAY_API_KEY") ?? readEnv("NEXT_PUBLIC_LATR_GATEWAY_API_KEY");
  return {
    ...(clientId ? { clientId } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function readWindowGatewayBootstrap(): LatrGatewayWindowBootstrap | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__LATR_GATEWAY_BOOTSTRAP__;
}

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

  const bootstrap = readWindowGatewayBootstrap();
  const credential =
    injectedGatewayClientCredential ??
    bootstrap?.clientCredential?.trim() ??
    readGatewayClientCredentialFromEnv();
  const splitFromInjection =
    injectedGatewayClientId && injectedGatewayApiKey
      ? { clientId: injectedGatewayClientId, apiKey: injectedGatewayApiKey }
      : undefined;
  const splitFromBootstrap =
    bootstrap?.clientId?.trim() && bootstrap?.apiKey?.trim()
      ? {
          clientId: bootstrap.clientId.trim(),
          apiKey: bootstrap.apiKey.trim(),
        }
      : undefined;
  const splitFromEnv = readGatewayClientCredentialsFromEnv();
  const clientId =
    splitFromInjection?.clientId ??
    splitFromBootstrap?.clientId ??
    splitFromEnv.clientId;
  const apiKey =
    splitFromInjection?.apiKey ??
    splitFromBootstrap?.apiKey ??
    splitFromEnv.apiKey;
  const gatewayUrl =
    process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim() ??
    bootstrap?.gatewayUrl?.trim();
  const appEnv = bootstrap?.appEnv ?? toLatrGatewayAppEnv();

  configureLatrGateway({
    gatewayUrl,
    appEnv,
    testingHostname: testingHostname ?? "",
    clientCredential: credential ?? "",
    clientId: clientId ?? "",
    apiKey: apiKey ?? "",
  });

  publishLatrGatewayWindowBootstrap({
    ...(gatewayUrl ? { gatewayUrl } : {}),
    appEnv,
    ...(credential ? { clientCredential: credential } : {}),
    ...(clientId && apiKey ? { clientId, apiKey } : {}),
  });
}

registerLatrGatewayConfigSync(syncLatrGatewayFromBrowser);

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

export function buildGatewayWindowBootstrap(
  appEnv: ReturnType<typeof toLatrGatewayAppEnv>
): LatrGatewayWindowBootstrap {
  const credentials = readGatewayClientCredentialsFromEnv();
  const clientCredential = readGatewayClientCredentialFromEnv();
  const gatewayUrl = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim();
  return {
    ...(credentials.clientId ? { clientId: credentials.clientId } : {}),
    ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    ...(clientCredential ? { clientCredential } : {}),
    ...(gatewayUrl ? { gatewayUrl } : {}),
    appEnv,
  };
}
