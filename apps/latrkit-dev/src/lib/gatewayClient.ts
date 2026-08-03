import type { OAuthSession } from "@atproto/oauth-client-browser";
import {
  createUpstreamDpopProof,
  LATR_UPSTREAM_DPOP_HEADER,
} from "latr-packages/gateway-client";

import { latrGatewayBaseUrl } from "@/lib/gatewayConfig";

/** Developer console management routes use OAuth only (no app API key). */
export async function latrGatewayFetch(
  oauthSession: OAuthSession,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const gatewayPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${latrGatewayBaseUrl()}${gatewayPath}`;
  const sessionProof = await createUpstreamDpopProof(
    oauthSession,
    "com.atproto.server.getSession",
    "GET"
  );
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  headers.set(LATR_UPSTREAM_DPOP_HEADER, sessionProof);

  return oauthSession.fetchHandler(url, {
    ...init,
    headers,
  });
}

const DEVELOPER_ROUTE_CLIENT_POLICY_HINT =
  "The testing gateway is rejecting developer console requests because it still requires app API keys on /v1/latr/developer/* — deploy the latest latr-gateway fix (developer routes must use OAuth + DPoP only).";

async function readGatewayError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      message?: string;
      error?: string;
      code?: string;
    };
    const message = body.message ?? body.error ?? `Gateway error (${res.status})`;
    if (
      res.status === 403 &&
      (body.code === "client_forbidden" ||
        body.code === "invalid_client_credential")
    ) {
      return `${message} ${DEVELOPER_ROUTE_CLIENT_POLICY_HINT}`;
    }
    return message;
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
