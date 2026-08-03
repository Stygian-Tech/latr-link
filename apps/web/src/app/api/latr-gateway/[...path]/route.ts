import { NextResponse } from "next/server";
import {
  DEFAULT_DEV_LATR_GATEWAY_URL,
  DEFAULT_PROD_LATR_GATEWAY_URL,
  DEFAULT_TESTING_LATR_GATEWAY_URL,
  LATR_GATEWAY_PROXY_BASE_PATH,
  LOCAL_LATR_GATEWAY_URL,
  readGatewayClientCredentialFromEnv,
  readGatewayClientCredentialsFromEnv,
} from "@/lib/latrGatewayUrl";
import {
  LATR_API_KEY_HEADER,
  LATR_CLIENT_ID_HEADER,
  LATR_OFFICIAL_CLIENT_HEADER,
} from "latr-web-client/latrGatewayConfig";
import {
  LATR_PROXY_USER_AUTHORIZATION_HEADER,
  LATR_PROXY_USER_DPOP_HEADER,
} from "latr-web-client/latrGatewayClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "dpop",
  "x-atproto-upstream-dpop",
  "x-latr-user-authorization",
  "x-latr-user-dpop",
]);

const LATR_FORWARDED_AUTHORIZATION_HEADER = "X-Latr-Forwarded-Authorization";
const LATR_FORWARDED_DPOP_HEADER = "X-Latr-Forwarded-DPoP";

const RESPONSE_HEADERS_TO_DROP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

type RequestWithOptionalNextUrl = Request & { nextUrl?: URL };

type ProxyForwardingDiagnostics = {
  userAuthorizationSource: "custom" | "direct" | "missing";
  userDpopSource: "custom" | "direct" | "missing";
};

function firstForwardedHeader(req: Request, name: string): string | undefined {
  return req.headers.get(name)?.split(",")[0]?.trim() || undefined;
}

function requestUrl(req: Request): URL {
  return (req as RequestWithOptionalNextUrl).nextUrl ?? new URL(req.url);
}

function forwardedHost(req: Request): string {
  return firstForwardedHeader(req, "x-forwarded-host") ?? requestUrl(req).host;
}

function forwardedProto(req: Request): string {
  return (
    firstForwardedHeader(req, "x-forwarded-proto") ??
    requestUrl(req).protocol.replace(":", "")
  );
}

function serverGatewayBaseUrl(req: Request): string {
  const internal = process.env.LATR_GATEWAY_INTERNAL_URL?.trim();
  if (internal) return internal.replace(/\/$/, "");

  const configured = process.env.NEXT_PUBLIC_LATR_GATEWAY_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  switch (forwardedHost(req).toLowerCase()) {
    case "testing.latr.link":
      return DEFAULT_TESTING_LATR_GATEWAY_URL;
    case "latr.link":
    case "www.latr.link":
      return DEFAULT_PROD_LATR_GATEWAY_URL;
    default:
      break;
  }

  switch ((process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV)?.trim()) {
    case "prod":
      return DEFAULT_PROD_LATR_GATEWAY_URL;
    case "dev":
      return DEFAULT_DEV_LATR_GATEWAY_URL;
    case "test":
      return DEFAULT_TESTING_LATR_GATEWAY_URL;
    default:
      return LOCAL_LATR_GATEWAY_URL;
  }
}

function gatewayCredentialHeaders(): Headers {
  const headers = new Headers();
  const { clientId, apiKey } = readGatewayClientCredentialsFromEnv();
  if (clientId && apiKey) {
    headers.set(LATR_CLIENT_ID_HEADER, clientId);
    headers.set(LATR_API_KEY_HEADER, apiKey);
    return headers;
  }

  const credential = readGatewayClientCredentialFromEnv();
  if (credential) {
    headers.set(LATR_OFFICIAL_CLIENT_HEADER, credential);
  }
  return headers;
}

function isLoopbackGatewayUrl(raw: string): boolean {
  try {
    const { hostname } = new URL(raw);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function hasGatewayCredentialHeaders(headers: Headers): boolean {
  return (
    Boolean(headers.get(LATR_OFFICIAL_CLIENT_HEADER)) ||
    (Boolean(headers.get(LATR_CLIENT_ID_HEADER)) &&
      Boolean(headers.get(LATR_API_KEY_HEADER)))
  );
}

function firstHeaderValue(req: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = req.headers.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function forwardedRequestHeaders(req: Request): {
  headers: Headers;
  diagnostics: ProxyForwardingDiagnostics;
} {
  const headers = new Headers();
  const url = requestUrl(req);
  for (const [name, value] of req.headers) {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  }

  const proxiedAuthorization = firstHeaderValue(req, [
    LATR_PROXY_USER_AUTHORIZATION_HEADER,
    LATR_PROXY_USER_AUTHORIZATION_HEADER.toLowerCase(),
  ]);
  if (proxiedAuthorization) {
    headers.set("authorization", proxiedAuthorization);
    headers.set(LATR_FORWARDED_AUTHORIZATION_HEADER, proxiedAuthorization);
    headers.delete(LATR_PROXY_USER_AUTHORIZATION_HEADER);
    headers.delete(LATR_PROXY_USER_AUTHORIZATION_HEADER.toLowerCase());
  }

  const proxiedDpop = firstHeaderValue(req, [
    LATR_PROXY_USER_DPOP_HEADER,
    LATR_PROXY_USER_DPOP_HEADER.toLowerCase(),
  ]);
  if (proxiedDpop) {
    headers.set("dpop", proxiedDpop);
    headers.set(LATR_FORWARDED_DPOP_HEADER, proxiedDpop);
    headers.delete(LATR_PROXY_USER_DPOP_HEADER);
    headers.delete(LATR_PROXY_USER_DPOP_HEADER.toLowerCase());
  }

  headers.set("X-Forwarded-Host", forwardedHost(req));
  headers.set("X-Forwarded-Proto", forwardedProto(req));
  headers.set(
    "X-Original-URI",
    `${LATR_GATEWAY_PROXY_BASE_PATH}${url.pathname.slice(LATR_GATEWAY_PROXY_BASE_PATH.length)}${url.search}`
  );

  for (const [name, value] of gatewayCredentialHeaders()) {
    headers.set(name, value);
  }
  return {
    headers,
    diagnostics: {
      userAuthorizationSource: proxiedAuthorization
        ? "custom"
        : headers.get("authorization")
          ? "direct"
          : "missing",
      userDpopSource: proxiedDpop
        ? "custom"
        : headers.get("dpop")
          ? "direct"
          : "missing",
    },
  };
}

async function proxyLatrGateway(req: Request): Promise<Response> {
  const url = requestUrl(req);
  const path = url.pathname.slice(LATR_GATEWAY_PROXY_BASE_PATH.length);
  const gatewayBase = serverGatewayBaseUrl(req);
  const target = `${gatewayBase}${path}${url.search}`;
  const { headers: requestHeaders, diagnostics } = forwardedRequestHeaders(req);
  if (
    !isLoopbackGatewayUrl(gatewayBase) &&
    !hasGatewayCredentialHeaders(requestHeaders)
  ) {
    return NextResponse.json(
      {
        error: "gateway_client_credentials_unconfigured",
        message:
          "L@tr gateway client credentials are not configured on the web server.",
      },
      { status: 500 }
    );
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : req.body;
  const upstream = await fetch(target, {
    method: req.method,
    headers: requestHeaders,
    body,
    redirect: "manual",
    cache: "no-store",
    // Required by fetch when forwarding a streaming Request body.
    duplex: body ? "half" : undefined,
  } as RequestInit & { duplex?: "half" });

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) {
      responseHeaders.set(name, value);
    }
  }
  responseHeaders.set("Cache-Control", "no-store");
  if (!upstream.ok) {
    responseHeaders.set(
      "X-Latr-Proxy-User-Authorization",
      diagnostics.userAuthorizationSource
    );
    responseHeaders.set("X-Latr-Proxy-User-DPoP", diagnostics.userDpopSource);
    responseHeaders.set(
      "X-Latr-Proxy-Upstream-Authorization",
      requestHeaders.get("authorization") ? "present" : "missing"
    );
    responseHeaders.set(
      "X-Latr-Proxy-Upstream-DPoP",
      requestHeaders.get("dpop") ? "present" : "missing"
    );
    responseHeaders.set(
      "X-Latr-Proxy-Forwarded-Authorization",
      requestHeaders.get(LATR_FORWARDED_AUTHORIZATION_HEADER) ? "present" : "missing"
    );
    responseHeaders.set(
      "X-Latr-Proxy-Forwarded-DPoP",
      requestHeaders.get(LATR_FORWARDED_DPOP_HEADER) ? "present" : "missing"
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyLatrGateway;
export const POST = proxyLatrGateway;
export const PATCH = proxyLatrGateway;
export const DELETE = proxyLatrGateway;
export const OPTIONS = proxyLatrGateway;
