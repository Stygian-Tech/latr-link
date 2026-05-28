import {
  configureLatrGateway,
  type LatrAppEnv,
} from "latr-web-client/latrGatewayConfig";

const DEFAULT_CLIENT_METADATA_URL =
  "https://latr.link/extension/client-metadata.json";

function readAppEnv(): LatrAppEnv {
  const raw = import.meta.env.VITE_LATR_APP_ENV?.trim();
  if (raw === "prod" || raw === "dev" || raw === "test") return raw;
  return "local";
}

/** Sync gateway URL and client API key headers from extension env. */
export function syncExtensionGatewayConfig(): void {
  configureLatrGateway({
    gatewayUrl: import.meta.env.VITE_LATR_GATEWAY_URL?.trim(),
    appEnv: readAppEnv(),
    clientCredential: import.meta.env.VITE_LATR_GATEWAY_CLIENT_CREDENTIAL?.trim(),
  });
}

export function extensionOAuthClientId(): string {
  const explicit = import.meta.env.VITE_ATPROTO_CLIENT_ID?.trim();
  if (explicit) return explicit;
  return DEFAULT_CLIENT_METADATA_URL;
}

export function extensionWebAppUrl(): string {
  return (
    import.meta.env.VITE_LATR_WEB_URL?.trim()?.replace(/\/$/, "") ??
    "https://latr.link"
  );
}
