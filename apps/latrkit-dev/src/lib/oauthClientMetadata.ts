import { LATRKIT_DEV_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";
import { inferGatewayApiBase } from "@/lib/latrGatewayUrl";

const PROD_CLIENT_METADATA_URL = "https://latrkit.dev/client-metadata.json";

export function gatewayLatrkitOAuthClientMetadataUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}/oauth/latrkit-client-metadata.json`;
}

function isDeploymentProtectedLatrkitHost(origin: string): boolean {
  try {
    return new URL(origin).hostname === "testing.latrkit.dev";
  } catch {
    return false;
  }
}

/** Hosted OAuth `client_id` for a web origin. */
export function hostedOAuthClientIdForOrigin(origin: string): string {
  const gateway = inferGatewayApiBase(origin);
  if (gateway && isDeploymentProtectedLatrkitHost(origin)) {
    return gatewayLatrkitOAuthClientMetadataUrl(gateway);
  }
  return `${origin.replace(/\/$/, "")}/client-metadata.json`;
}

/** True when Bluesky must fetch metadata from the public gateway (SPA is deployment-protected). */
export function originUsesGatewayOAuthClientMetadata(origin: string): boolean {
  const base = origin.replace(/\/$/, "");
  return hostedOAuthClientIdForOrigin(origin) !== `${base}/client-metadata.json`;
}

/**
 * Resolve hosted OAuth client_id in the browser.
 * Gateway client_id wins over `NEXT_PUBLIC_ATPROTO_CLIENT_ID` when the SPA host is
 * configured to publish metadata from the public gateway (testing.latrkit.dev).
 */
export function resolveHostedOAuthClientId(origin: string): string {
  const fromOrigin = hostedOAuthClientIdForOrigin(origin);
  if (originUsesGatewayOAuthClientMetadata(origin)) {
    return fromOrigin;
  }
  const explicit = process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID?.trim();
  if (explicit && explicit !== PROD_CLIENT_METADATA_URL) {
    return explicit;
  }
  return fromOrigin;
}

/** Discoverable ATProto OAuth client metadata for same-origin (unprotected) hosts. */
export function buildConsoleOAuthClientMetadata(origin: string) {
  const base = origin.replace(/\/$/, "");
  return {
    client_id: `${base}/client-metadata.json`,
    application_type: "web",
    client_name: "LatrKit Developer Console",
    client_uri: base,
    dpop_bound_access_tokens: true,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [`${base}/callback`],
    response_types: ["code"],
    scope: LATRKIT_DEV_OAUTH_SCOPES,
    token_endpoint_auth_method: "none",
  };
}
