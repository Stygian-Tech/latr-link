import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  bookmarkUpstreamProofPlanForGatewayRequest,
  createBookmarkMigrationRequestBody,
  createUpstreamDpopProof,
  LATR_GATEWAY_MIGRATE_LEXICONS_PATH,
  LATR_GATEWAY_SAVES_PATH,
  LATR_UPSTREAM_DPOP_HEADER,
  pdsXrpcMethodForGatewayRequest,
  type UpstreamDpopProofOptions,
} from "latr-packages/gateway-client";

import { createChainedUpstreamDpopProofPool } from "./upstreamDpopPool";

import {
  assertLatrGatewayClientCredential,
  latrGatewayBaseUrl,
  latrGatewayClientHeaders,
  LATR_OFFICIAL_CLIENT_HEADER,
  resolveLatrGatewayConfig,
} from "./latrGatewayConfig";
import { LATR_XRPC, latrXrpcPath } from "./xrpcMethods";

export { LATR_OFFICIAL_CLIENT_HEADER, LATR_UPSTREAM_DPOP_HEADER };

export const LATR_PROXY_USER_AUTHORIZATION_HEADER = "X-Latr-User-Authorization";
export const LATR_PROXY_USER_DPOP_HEADER = "X-Latr-User-DPoP";

export type LatrGatewayFetchOptions = {
  /** Developer console management routes use OAuth only (no app API key). */
  skipClientCredential?: boolean;
};

type TokenSet = {
  access_token: string;
  token_type?: string;
};

type SessionWithTokenSet = OAuthSession & {
  getTokenSet(refresh: boolean | "auto"): Promise<TokenSet>;
};

const PDS_SESSION_ATTESTATION_PATHS = new Set([
  "/v1/latr/discover/at-uri",
  "/v1/latr/og-preview",
  latrXrpcPath(LATR_XRPC.resolveUrl),
  latrXrpcPath(LATR_XRPC.getOpenGraph),
]);

const XRPC_SAVE_PATHS = new Set([
  latrXrpcPath(LATR_XRPC.saveUrl),
  latrXrpcPath(LATR_XRPC.saveSubject),
]);

function stripQueryAndFragment(url: string): string {
  const fragmentIndex = url.indexOf("#");
  const queryIndex = url.indexOf("?");
  if (fragmentIndex === -1 && queryIndex === -1) return url;
  if (fragmentIndex === -1) return url.slice(0, queryIndex);
  if (queryIndex === -1) return url.slice(0, fragmentIndex);
  return url.slice(0, Math.min(fragmentIndex, queryIndex));
}

async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function buildGatewayUserAuthHeaders(
  oauthSession: OAuthSession,
  method: string,
  gatewayUrl: string,
  tokenSet: TokenSet
): Promise<Record<string, string>> {
  const key = oauthSession.server.dpopKey;
  const jwk = key.bareJwk;
  if (!jwk) {
    throw new Error("OAuth session DPoP key is unavailable");
  }

  const supported =
    oauthSession.server.serverMetadata.dpop_signing_alg_values_supported;
  const alg =
    supported?.find((candidate) => key.algorithms.includes(candidate)) ??
    key.algorithms[0];
  if (!alg) {
    throw new Error("OAuth session DPoP key has no supported algorithm");
  }

  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, string | number> = {
    iat: now,
    jti: Math.random().toString(36).slice(2),
    htm: method.toUpperCase(),
    htu: stripQueryAndFragment(gatewayUrl),
    ath: await sha256Base64Url(tokenSet.access_token),
  };
  const dpop = await key.createJwt({ alg, typ: "dpop+jwt", jwk }, claims);

  return {
    Authorization: `${tokenSet.token_type ?? "DPoP"} ${tokenSet.access_token}`,
    DPoP: dpop,
  };
}

function isSameOriginGatewayProxyUrl(url: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === window.location.origin &&
      parsed.pathname.startsWith("/api/latr-gateway/")
    );
  } catch {
    return false;
  }
}

function headersForGatewayHop(
  url: string,
  userAuthHeaders: Record<string, string>
): Record<string, string> {
  if (!isSameOriginGatewayProxyUrl(url)) return userAuthHeaders;

  return {
    [LATR_PROXY_USER_AUTHORIZATION_HEADER]: userAuthHeaders.Authorization,
    [LATR_PROXY_USER_DPOP_HEADER]: userAuthHeaders.DPoP,
  };
}

/** Upstream proofs for GET /v1/latr/saves (paginated listRecords only). */
export async function createListSavesUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  return createChainedUpstreamDpopProofPool(
    oauthSession,
    [{ xrpcMethod: "com.atproto.repo.listRecords", httpMethod: "GET", count: 8 }],
    options
  );
}

/** Upstream proofs for POST /v1/latr/migrate-lexicons (legacy copy + delete). */
export async function createMigrateLexiconsUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  return createChainedUpstreamDpopProofPool(
    oauthSession,
    [
      { xrpcMethod: "com.atproto.repo.listRecords", httpMethod: "GET", count: 8 },
      { xrpcMethod: "com.atproto.repo.createRecord", httpMethod: "POST", count: 12 },
      { xrpcMethod: "com.atproto.repo.deleteRecord", httpMethod: "POST", count: 12 },
    ],
    options
  );
}

/** Upstream proofs for POST /v1/latr/saves (external wrapper + saved item writes). */
export async function createSaveUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  return createChainedUpstreamDpopProofPool(
    oauthSession,
    [
      { xrpcMethod: "com.atproto.repo.createRecord", httpMethod: "POST", count: 4 },
      { xrpcMethod: "com.atproto.repo.putRecord", httpMethod: "POST", count: 4 },
    ],
    options
  );
}

export async function createSetStateUpstreamDpopProofPool(
  oauthSession: OAuthSession,
  options: UpstreamDpopProofOptions = {}
): Promise<string> {
  return createChainedUpstreamDpopProofPool(
    oauthSession,
    [
      { xrpcMethod: "com.atproto.repo.getRecord", httpMethod: "GET", count: 2 },
      { xrpcMethod: "com.atproto.repo.putRecord", httpMethod: "POST", count: 2 },
    ],
    options
  );
}

export async function latrGatewayFetch(
  oauthSession: OAuthSession,
  path: string,
  init?: RequestInit,
  options?: LatrGatewayFetchOptions
): Promise<Response> {
  const gatewayPath = path.startsWith("/") ? path : `/${path}`;
  const config = resolveLatrGatewayConfig();
  if (!options?.skipClientCredential) {
    assertLatrGatewayClientCredential(config);
  }
  const url = `${latrGatewayBaseUrl(config)}${gatewayPath}`;
  const method = init?.method ?? "GET";
  const clientHeaders = latrGatewayClientHeaders(config);

  const upstream = pdsXrpcMethodForGatewayRequest(method, gatewayPath);
  const gatewayPathOnly = stripQueryAndFragment(gatewayPath);
  const bookmarkProofPlan = bookmarkUpstreamProofPlanForGatewayRequest(
    method,
    gatewayPathOnly
  );
  const upstreamHeaders: Record<string, string> = {};
  let requestBody = init?.body;
  const sessionWithTokenSet = oauthSession as SessionWithTokenSet;
  const tokenSet = await sessionWithTokenSet.getTokenSet("auto");
  const proofOptions = { accessToken: tokenSet.access_token };
  const userAuthHeaders = await buildGatewayUserAuthHeaders(
    oauthSession,
    method,
    url,
    tokenSet
  );
  const hopUserAuthHeaders = headersForGatewayHop(url, userAuthHeaders);

  if (bookmarkProofPlan?.transport === "body") {
    const parsed = typeof requestBody === "string"
      ? JSON.parse(requestBody) as Record<string, unknown>
      : {};
    requestBody = await createBookmarkMigrationRequestBody(
      oauthSession,
      parsed,
      proofOptions
    );
    upstreamHeaders["Content-Type"] = "application/json";
  } else if (bookmarkProofPlan?.transport === "header") {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createChainedUpstreamDpopProofPool(
        oauthSession,
        [...bookmarkProofPlan.specs],
        proofOptions
      );
  } else if (
    method === "GET" &&
    PDS_SESSION_ATTESTATION_PATHS.has(gatewayPathOnly)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createUpstreamDpopProof(
        oauthSession,
        "com.atproto.server.getSession",
        "GET",
        proofOptions
      );
  } else if (
    method === "POST" &&
    (gatewayPathOnly === LATR_GATEWAY_SAVES_PATH || XRPC_SAVE_PATHS.has(gatewayPathOnly))
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createSaveUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (
    method === "POST" &&
    gatewayPathOnly === LATR_GATEWAY_MIGRATE_LEXICONS_PATH
  ) {
    // This proof pool contains enough JWTs for the legacy copy/delete pass and
    // can exceed reverse-proxy header limits. The gateway accepts it in the
    // request body for this endpoint while retaining header support for older
    // clients.
    requestBody = JSON.stringify({
      upstreamDpopProof: await createMigrateLexiconsUpstreamDpopProofPool(
        oauthSession,
        proofOptions
      ),
    });
    upstreamHeaders["Content-Type"] = "application/json";
  } else if (
    method === "POST" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.migrateLegacy)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createMigrateLexiconsUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (method === "GET" && gatewayPathOnly === LATR_GATEWAY_SAVES_PATH) {
    // Paged requests (`?limit=`) trigger a single upstream listRecords call;
    // the bare path drains every page and needs the full proof pool.
    const queryIndex = gatewayPath.indexOf("?");
    const search = new URLSearchParams(
      queryIndex === -1 ? "" : gatewayPath.slice(queryIndex + 1)
    );
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = search.has("limit")
      ? await createUpstreamDpopProof(
          oauthSession,
          "com.atproto.repo.listRecords",
          "GET",
          proofOptions
        )
      : await createListSavesUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (
    method === "GET" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.listItems)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      "com.atproto.repo.listRecords",
      "GET",
      proofOptions
    );
  } else if (
    method === "POST" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.setState)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createSetStateUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (
    method === "POST" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.deleteItem)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      "com.atproto.repo.deleteRecord",
      "POST",
      proofOptions
    );
  } else if (
    method === "GET" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.getItem)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      "com.atproto.repo.getRecord",
      "GET",
      proofOptions
    );
  } else if (
    method === "GET" &&
    gatewayPathOnly === latrXrpcPath(LATR_XRPC.authProbe)
  ) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      "com.atproto.repo.listRecords",
      "GET",
      proofOptions
    );
  } else if (upstream) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      upstream.xrpcMethod,
      upstream.httpMethod,
      proofOptions
    );
  }

  return fetch(url, {
    ...init,
    body: requestBody,
    headers: {
      Accept: "application/json",
      ...clientHeaders,
      ...hopUserAuthHeaders,
      ...upstreamHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

async function readGatewayError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Gateway error (${res.status})`;
  } catch {
    return `Gateway error (${res.status})`;
  }
}

export async function latrGatewayJson<T>(
  oauthSession: OAuthSession,
  path: string,
  init?: RequestInit,
  options?: LatrGatewayFetchOptions
): Promise<T> {
  const res = await latrGatewayFetch(oauthSession, path, init, options);
  if (!res.ok) {
    throw new Error(await readGatewayError(res));
  }
  return (await res.json()) as T;
}
