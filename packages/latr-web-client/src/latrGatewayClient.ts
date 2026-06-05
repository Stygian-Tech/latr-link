import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
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

export { LATR_OFFICIAL_CLIENT_HEADER, LATR_UPSTREAM_DPOP_HEADER };

export type LatrGatewayFetchOptions = {
  /** Developer console management routes use OAuth only (no app API key). */
  skipClientCredential?: boolean;
};

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
  const upstreamHeaders: Record<string, string> = {};
  const sessionWithTokenSet = oauthSession as OAuthSession & {
    getTokenSet(refresh: boolean | "auto"): Promise<{ access_token: string }>;
  };
  const tokenSet = await sessionWithTokenSet.getTokenSet("auto");
  const proofOptions = { accessToken: tokenSet.access_token };

  if (method === "POST" && gatewayPath === LATR_GATEWAY_SAVES_PATH) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createSaveUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (method === "POST" && gatewayPath === LATR_GATEWAY_MIGRATE_LEXICONS_PATH) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createMigrateLexiconsUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (method === "GET" && gatewayPath === LATR_GATEWAY_SAVES_PATH) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createListSavesUpstreamDpopProofPool(oauthSession, proofOptions);
  } else if (upstream) {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] = await createUpstreamDpopProof(
      oauthSession,
      upstream.xrpcMethod,
      upstream.httpMethod,
      proofOptions
    );
  }

  return oauthSession.fetchHandler(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...clientHeaders,
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
