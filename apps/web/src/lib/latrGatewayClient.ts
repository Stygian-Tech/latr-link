import type { OAuthSession } from "@atproto/oauth-client-browser";

/** Matches gateway `X-ATProto-Upstream-DPoP` for PDS-bound write-through proofs. */
export const LATR_UPSTREAM_DPOP_HEADER = "X-ATProto-Upstream-DPoP";

export function latrGatewayBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_LATR_GATEWAY_URL ?? "http://127.0.0.1:8080"
  ).replace(/\/$/, "");
}

export async function latrGatewayFetch(
  oauthSession: OAuthSession,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${latrGatewayBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return oauthSession.fetchHandler(url, {
    ...init,
    headers: {
      Accept: "application/json",
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
