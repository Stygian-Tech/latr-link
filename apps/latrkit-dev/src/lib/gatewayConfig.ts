export const LOCAL_LATR_GATEWAY_URL = "http://127.0.0.1:8080";
export const DEFAULT_TESTING_LATR_GATEWAY_URL = "https://api.testing.latr.link";
export const DEFAULT_DEV_LATR_GATEWAY_URL =
  "https://api.testing.latr.link";
export const DEFAULT_PROD_LATR_GATEWAY_URL =
  "https://api.latr.link";

export type LatrAppEnv = "local" | "dev" | "prod" | "test";

export type LatrGatewayEnvConfig = {
  gatewayUrl?: string;
  appEnv?: LatrAppEnv;
  testingHostname?: string;
};

let globalGatewayConfig: LatrGatewayEnvConfig = {
  appEnv: "local",
};

export function configureLatrGateway(config: LatrGatewayEnvConfig): void {
  globalGatewayConfig = { ...globalGatewayConfig, ...config };
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
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

function gatewayForKnownHostname(hostname: string | undefined): string | undefined {
  switch (hostname?.toLowerCase()) {
    case "testing.latr.link":
    case "testing.latrkit.dev":
      return DEFAULT_TESTING_LATR_GATEWAY_URL;
    case "latr.link":
    case "www.latr.link":
      return DEFAULT_PROD_LATR_GATEWAY_URL;
    default:
      return undefined;
  }
}

export function latrGatewayBaseUrl(
  config: LatrGatewayEnvConfig = globalGatewayConfig
): string {
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
