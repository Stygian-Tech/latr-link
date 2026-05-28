import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  createSaveUpstreamDpopProofPool,
  createUpstreamDpopProof,
  LATR_UPSTREAM_DPOP_HEADER,
  pdsXrpcMethodForGatewayRequest,
} from "latr-packages/gateway-client";

import {
  getLatrGatewayConfig,
  latrGatewayBaseUrl,
  latrGatewayClientHeaders,
  LATR_OFFICIAL_CLIENT_HEADER,
} from "./latrGatewayConfig";

export { LATR_OFFICIAL_CLIENT_HEADER, LATR_UPSTREAM_DPOP_HEADER };

export async function latrGatewayFetch(
  oauthSession: OAuthSession,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const gatewayPath = path.startsWith("/") ? path : `/${path}`;
  const config = getLatrGatewayConfig();
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

  if (method === "POST" && gatewayPath === "/v1/latr/saves") {
    upstreamHeaders[LATR_UPSTREAM_DPOP_HEADER] =
      await createSaveUpstreamDpopProofPool(oauthSession, proofOptions);
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
  init?: RequestInit
): Promise<T> {
  const res = await latrGatewayFetch(oauthSession, path, init);
  if (!res.ok) {
    throw new Error(await readGatewayError(res));
  }
  return (await res.json()) as T;
}
