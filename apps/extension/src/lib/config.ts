import {
  configureLatrGateway,
  type LatrAppEnv,
  type LatrGatewayEnvConfig,
} from "latr-web-client/latrGatewayConfig";

const DEFAULT_CLIENT_METADATA_URL =
  "https://latr-link-prod-gateway.fly.dev/oauth/extension-client-metadata.json";
const DEFAULT_REDIRECT_URI = "https://latr.link/extension/callback";

export type ExtensionEnv = {
  [key: string]: unknown;
  VITE_LATR_GATEWAY_URL?: string;
  VITE_LATR_APP_ENV?: string;
  VITE_LATR_GATEWAY_CLIENT_ID?: string;
  VITE_LATR_GATEWAY_API_KEY?: string;
  VITE_ATPROTO_CLIENT_ID?: string;
  VITE_ATPROTO_REDIRECT_URI?: string;
  VITE_LATR_WEB_URL?: string;
};

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

function readAppEnv(env: ExtensionEnv): LatrAppEnv {
  const raw = env.VITE_LATR_APP_ENV?.trim();
  if (raw === "prod" || raw === "dev" || raw === "test") return raw;
  return "local";
}

/** Sync gateway URL and client API key headers from extension env. */
export function extensionGatewayConfig(env: ExtensionEnv): LatrGatewayEnvConfig {
  const clientId = trimmed(env.VITE_LATR_GATEWAY_CLIENT_ID);
  const apiKey = trimmed(env.VITE_LATR_GATEWAY_API_KEY);
  if (Boolean(clientId) !== Boolean(apiKey)) {
    throw new Error(
      "Extension Gateway Authentication Requires Both VITE_LATR_GATEWAY_CLIENT_ID and VITE_LATR_GATEWAY_API_KEY."
    );
  }
  return {
    gatewayUrl: trimmed(env.VITE_LATR_GATEWAY_URL),
    appEnv: readAppEnv(env),
    clientId,
    apiKey,
  };
}

export function syncExtensionGatewayConfig(): void {
  configureLatrGateway(extensionGatewayConfig(import.meta.env));
}

function validatedHttpsUrl(value: string, variableName: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${variableName} Must Be a Credential-Free HTTPS URL.`);
  }
  return parsed.href;
}

export function extensionOAuthClientId(
  env: ExtensionEnv = import.meta.env
): string {
  return validatedHttpsUrl(
    trimmed(env.VITE_ATPROTO_CLIENT_ID) ?? DEFAULT_CLIENT_METADATA_URL,
    "VITE_ATPROTO_CLIENT_ID"
  );
}

export function extensionOAuthRedirectUri(
  env: ExtensionEnv = import.meta.env
): string {
  const value = validatedHttpsUrl(
    trimmed(env.VITE_ATPROTO_REDIRECT_URI) ?? DEFAULT_REDIRECT_URI,
    "VITE_ATPROTO_REDIRECT_URI"
  );
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new Error("VITE_ATPROTO_REDIRECT_URI Must Not Include a Query or Fragment.");
  }
  return value;
}

export function extensionWebAppUrl(): string {
  return (
    import.meta.env.VITE_LATR_WEB_URL?.trim()?.replace(/\/$/, "") ??
    "https://latr.link"
  );
}
