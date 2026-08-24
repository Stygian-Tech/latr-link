export type LatrAppEnv = "local" | "dev" | "prod" | "test";
export type LatrGatewayEnvConfig = {
  gatewayUrl?: string;
  appEnv?: LatrAppEnv;
  testingHostname?: string;
  clientCredential?: string;
  clientId?: string;
  apiKey?: string;
};

export const DEFAULT_PROD_LATR_GATEWAY_PROXY_URL =
  "https://latr.link/api/latr-gateway";
export const LATR_OFFICIAL_CLIENT_HEADER = "X-Latr-Official-Client";

let storeConfig: LatrGatewayEnvConfig = {
  gatewayUrl: DEFAULT_PROD_LATR_GATEWAY_PROXY_URL,
  appEnv: "prod",
};

export function isTrustedLatrGatewayProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === "https://latr.link" &&
      parsed.pathname.replace(/\/$/, "") === "/api/latr-gateway"
    );
  } catch {
    return false;
  }
}

export function configureLatrGateway(config: LatrGatewayEnvConfig): void {
  const gatewayUrl = config.gatewayUrl?.trim().replace(/\/$/, "");
  if (gatewayUrl && !isTrustedLatrGatewayProxyUrl(gatewayUrl)) {
    throw new Error("Store builds only support the L@tr.link gateway proxy.");
  }
  storeConfig = {
    gatewayUrl: DEFAULT_PROD_LATR_GATEWAY_PROXY_URL,
    appEnv: "prod",
  };
}

export function resolveLatrGatewayConfig(): LatrGatewayEnvConfig {
  return storeConfig;
}

export function latrGatewayBaseUrl(): string {
  return DEFAULT_PROD_LATR_GATEWAY_PROXY_URL;
}

export function latrGatewayClientHeaders(): Record<string, string> {
  return {};
}

export function assertLatrGatewayClientCredential(): void {
  if (!isTrustedLatrGatewayProxyUrl(latrGatewayBaseUrl())) {
    throw new Error("Store gateway proxy configuration is invalid.");
  }
}
