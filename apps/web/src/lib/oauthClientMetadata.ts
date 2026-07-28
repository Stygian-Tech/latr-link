import { AT_PROTO_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";
import { inferGatewayApiBase } from "@/lib/latrGatewayUrl";

const PROD_CLIENT_METADATA_URL = "https://latr.link/client-metadata.json";

export function gatewayWebOAuthClientMetadataUrl(apiBase: string): string {
  return `${apiBase.replace(/\/$/, "")}/oauth/client-metadata.json`;
}

/** Hosted OAuth `client_id` for a web origin. */
export function hostedOAuthClientIdForOrigin(origin: string): string {
  const gateway = inferGatewayApiBase(origin);
  if (gateway) {
    return gatewayWebOAuthClientMetadataUrl(gateway);
  }
  return `${origin.replace(/\/$/, "")}/client-metadata.json`;
}

/** True when the origin must use public gateway metadata (not same-origin SPA JSON). */
export function originUsesGatewayOAuthClientMetadata(origin: string): boolean {
  const base = origin.replace(/\/$/, "");
  return hostedOAuthClientIdForOrigin(origin) !== `${base}/client-metadata.json`;
}

/**
 * Resolve hosted OAuth client_id in the browser.
 * Gateway client_id wins over `NEXT_PUBLIC_ATPROTO_CLIENT_ID` when the SPA host is
 * deployment-protected (e.g. testing.latr.link behind Vercel auth).
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

/** Discoverable ATProto OAuth client metadata for the web SPA at a given origin. */
export function buildWebOAuthClientMetadata(origin: string) {
  const base = origin.replace(/\/$/, "");
  return {
    client_id: `${base}/client-metadata.json`,
    application_type: "web",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: [`${base}/callback`],
    scope: AT_PROTO_OAUTH_SCOPES,
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
    client_name: "L@tr.link",
    client_uri: base,
    logo_uri: `${base}/icon.png`,
  } as const;
}
