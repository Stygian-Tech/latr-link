import {
  buildDeveloperGatewayHeaders,
  LATR_API_KEY_HEADER,
  LATR_CLIENT_ID_HEADER,
} from "latr-packages/gateway-client";

export { LATR_API_KEY_HEADER, LATR_CLIENT_ID_HEADER };

/** Official gateway client id for L@tr.link web (env key in `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS`). */
export const LATR_LINK_WEB_CLIENT_ID = "latr-link-web";

/** Official gateway client id for The Social Wire web (env key in `LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS`). */
export const THE_SOCIAL_WIRE_WEB_CLIENT_ID = "the-social-wire-web";

export const LOCAL_LATR_GATEWAY_URL = "http://127.0.0.1:8080";
export const DEFAULT_TESTING_LATR_GATEWAY_URL = "https://api.testing.latr.link";
export const DEFAULT_DEV_LATR_GATEWAY_URL =
  "https://latr-link-dev-gateway.fly.dev";
export const DEFAULT_PROD_LATR_GATEWAY_URL =
  "https://latr-link-prod-gateway.fly.dev";

export type LatrAppEnv = "local" | "dev" | "prod" | "test";

export type LatrGatewayEnvConfig = {
  /** Explicit gateway base URL (wins over app env defaults). */
  gatewayUrl?: string;
  appEnv?: LatrAppEnv;
  /** When app env is dev, use testing gateway for this hostname. */
  testingHostname?: string;
  /** Base64 official client credential (internal first-party; legacy header). */
  clientCredential?: string;
  /** Split developer API key auth (preferred for third-party and console-issued keys). */
  clientId?: string;
  apiKey?: string;
};

/** Server-injected bootstrap for hosted web apps (survives duplicate client bundles). */
export type LatrGatewayWindowBootstrap = Pick<
  LatrGatewayEnvConfig,
  "clientId" | "apiKey" | "clientCredential" | "gatewayUrl" | "appEnv"
>;

declare global {
  interface Window {
    __LATR_GATEWAY_BOOTSTRAP__?: LatrGatewayWindowBootstrap;
  }
}

let globalGatewayConfig: LatrGatewayEnvConfig = {
  appEnv: "local",
};

type LatrGatewayConfigSync = () => void;
let gatewayConfigSync: LatrGatewayConfigSync | undefined;

function readWindowGatewayBootstrap(): LatrGatewayWindowBootstrap | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__LATR_GATEWAY_BOOTSTRAP__;
}

function mergeGatewayConfigWithWindowBootstrap(
  config: LatrGatewayEnvConfig
): LatrGatewayEnvConfig {
  const bootstrap = readWindowGatewayBootstrap();
  if (!bootstrap) return config;

  const clientId = bootstrap.clientId?.trim();
  const apiKey = bootstrap.apiKey?.trim();
  const clientCredential = bootstrap.clientCredential?.trim();
  const gatewayUrl = bootstrap.gatewayUrl?.trim();

  return {
    ...config,
    ...(bootstrap.appEnv ? { appEnv: bootstrap.appEnv } : {}),
    ...(gatewayUrl ? { gatewayUrl } : {}),
    ...(clientCredential ? { clientCredential } : {}),
    ...(clientId && apiKey ? { clientId, apiKey } : {}),
  };
}

/** Host apps register runtime sync (env injection, hostname mapping) before gateway calls. */
export function registerLatrGatewayConfigSync(fn: LatrGatewayConfigSync): void {
  gatewayConfigSync = fn;
}

export function hasRegisteredLatrGatewayConfigSync(): boolean {
  return gatewayConfigSync !== undefined;
}

/** Refresh config from registered host sync, then return the active snapshot. */
export function resolveLatrGatewayConfig(): LatrGatewayEnvConfig {
  gatewayConfigSync?.();
  return mergeGatewayConfigWithWindowBootstrap(globalGatewayConfig);
}

/** Persist credentials on `window` so all client bundles share the same runtime config. */
export function publishLatrGatewayWindowBootstrap(
  bootstrap: LatrGatewayWindowBootstrap
): void {
  if (typeof window === "undefined") return;
  window.__LATR_GATEWAY_BOOTSTRAP__ = {
    ...window.__LATR_GATEWAY_BOOTSTRAP__,
    ...bootstrap,
  };
}

/** Configure gateway URL and client credential headers for the current runtime. */
export function configureLatrGateway(config: LatrGatewayEnvConfig): void {
  const next: LatrGatewayEnvConfig = { ...globalGatewayConfig };
  if (config.gatewayUrl !== undefined) next.gatewayUrl = config.gatewayUrl;
  if (config.appEnv !== undefined) next.appEnv = config.appEnv;
  if (config.testingHostname !== undefined) {
    next.testingHostname = config.testingHostname;
  }
  if (config.clientCredential !== undefined) {
    next.clientCredential = config.clientCredential;
  }
  if (config.clientId !== undefined) next.clientId = config.clientId;
  if (config.apiKey !== undefined) next.apiKey = config.apiKey;
  globalGatewayConfig = next;
}

export function getLatrGatewayConfig(): LatrGatewayEnvConfig {
  return globalGatewayConfig;
}

function isLoopbackHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}

function isLoopbackGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

/** Known hosted web origins → gateway API base when env vars are misconfigured. */
function gatewayForKnownHostname(hostname: string | undefined): string | undefined {
  switch (hostname?.toLowerCase()) {
    case "testing.latr.link":
      return DEFAULT_TESTING_LATR_GATEWAY_URL;
    case "latr.link":
    case "www.latr.link":
      return DEFAULT_PROD_LATR_GATEWAY_URL;
    default:
      return undefined;
  }
}

export function latrGatewayBaseUrl(config: LatrGatewayEnvConfig = globalGatewayConfig): string {
  const hostname = config.testingHostname?.trim();
  const configured = config.gatewayUrl?.trim();
  if (configured) {
    const normalized = configured.replace(/\/$/, "");
    const ignoreLoopbackOverride =
      Boolean(hostname) &&
      !isLoopbackHostname(hostname) &&
      isLoopbackGatewayUrl(normalized);
    if (!ignoreLoopbackOverride) return normalized;
  }

  const knownHosted = gatewayForKnownHostname(hostname);
  if (knownHosted) return knownHosted;

  switch (config.appEnv ?? "local") {
    case "prod":
      return DEFAULT_PROD_LATR_GATEWAY_URL;
    case "dev":
      return DEFAULT_DEV_LATR_GATEWAY_URL;
    case "test":
      return DEFAULT_TESTING_LATR_GATEWAY_URL;
    default:
      if (hostname && !isLoopbackHostname(hostname)) {
        return DEFAULT_DEV_LATR_GATEWAY_URL;
      }
      return LOCAL_LATR_GATEWAY_URL;
  }
}

export const LATR_OFFICIAL_CLIENT_HEADER = "X-Latr-Official-Client";

export function latrGatewayClientHeaders(
  config?: LatrGatewayEnvConfig
): Record<string, string> {
  const resolved = config ?? resolveLatrGatewayConfig();
  const clientId = resolved.clientId?.trim();
  const apiKey = resolved.apiKey?.trim();
  if (clientId && apiKey) {
    return buildDeveloperGatewayHeaders({ clientId, apiKey });
  }

  const credential = resolved.clientCredential?.trim();
  if (!credential) return {};
  return {
    [LATR_OFFICIAL_CLIENT_HEADER]: credential,
  };
}

/** Throws when calling a non-loopback gateway without an official client credential. */
export function assertLatrGatewayClientCredential(
  config?: LatrGatewayEnvConfig
): void {
  const resolved = config ?? resolveLatrGatewayConfig();
  const headers = latrGatewayClientHeaders(resolved);
  if (headers[LATR_CLIENT_ID_HEADER] && headers[LATR_API_KEY_HEADER]) return;
  if (headers[LATR_OFFICIAL_CLIENT_HEADER]) return;
  const base = latrGatewayBaseUrl(resolved);
  if (isLoopbackGatewayUrl(base)) return;

  const bootstrap = readWindowGatewayBootstrap();
  const bootstrapClientId = Boolean(bootstrap?.clientId?.trim());
  const bootstrapApiKey = Boolean(bootstrap?.apiKey?.trim());
  const bootstrapCredential = Boolean(bootstrap?.clientCredential?.trim());
  throw new Error(
    [
      "Hosted L@tr gateway requires client credentials.",
      "Set LATR_GATEWAY_CLIENT_ID + LATR_GATEWAY_API_KEY (split headers) or LATR_GATEWAY_CLIENT_CREDENTIAL (legacy official header).",
      "On Vercel, enable them for Preview as well as Production when using testing.latr.link, then redeploy.",
      `Diagnostic: bootstrapClientId=${bootstrapClientId}, bootstrapApiKey=${bootstrapApiKey}, bootstrapCredential=${bootstrapCredential}, configSync=${hasRegisteredLatrGatewayConfigSync()}.`,
    ].join(" ")
  );
}
