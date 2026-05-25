import { AT_PROTO_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";

const PROD_CLIENT_METADATA_URL = "https://latr.link/client-metadata.json";

/** Hosted OAuth `client_id` for a web origin (same-origin discoverable metadata). */
export function hostedOAuthClientIdForOrigin(origin: string): string {
  return `${origin.replace(/\/$/, "")}/client-metadata.json`;
}

/**
 * Resolve hosted OAuth client_id in the browser.
 * Preview/dev hosts use same-origin `/client-metadata.json` unless
 * `NEXT_PUBLIC_ATPROTO_CLIENT_ID` overrides (and is not the prod default).
 */
export function resolveHostedOAuthClientId(origin: string): string {
  const fromOrigin = hostedOAuthClientIdForOrigin(origin);
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
  } as const;
}
