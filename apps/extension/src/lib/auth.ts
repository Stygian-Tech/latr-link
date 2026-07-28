import { BrowserOAuthClient, type OAuthSession } from "@atproto/oauth-client-browser";

import { AT_PROTO_OAUTH_SCOPES } from "latr-web-client/atprotoOAuthScopes";
import { BSKY_APPVIEW_PUBLIC } from "latr-web-client/resolveSaveInput";

import {
  extensionOAuthClientId,
  extensionOAuthRedirectUri,
} from "./config";

let clientPromise: Promise<BrowserOAuthClient> | null = null;

function createFetchWithDeadline(
  timeoutMs: number,
  base: typeof fetch = fetch
): typeof fetch {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit) => {
    const c = new AbortController();
    const timer = globalThis.setTimeout(() => c.abort(), timeoutMs);
    const incoming = init?.signal;
    if (incoming) {
      if (incoming.aborted) {
        globalThis.clearTimeout(timer);
        return Promise.reject(incoming.reason);
      }
      incoming.addEventListener(
        "abort",
        () => {
          globalThis.clearTimeout(timer);
          c.abort(incoming.reason);
        },
        { once: true }
      );
    }
    const merged =
      typeof AbortSignal !== "undefined" && "any" in AbortSignal
        ? AbortSignal.any(incoming ? [c.signal, incoming] : [c.signal])
        : c.signal;
    return base(input, { ...init, signal: merged }).finally(() => {
      globalThis.clearTimeout(timer);
    });
  };
  return wrapped as typeof fetch;
}

const OAUTH_FETCH_DEADLINE_MS = 90_000;

export async function getExtensionOAuthClient(): Promise<BrowserOAuthClient> {
  if (!clientPromise) {
    clientPromise = BrowserOAuthClient.load({
      clientId: extensionOAuthClientId(),
      handleResolver: BSKY_APPVIEW_PUBLIC,
      fetch: createFetchWithDeadline(OAUTH_FETCH_DEADLINE_MS),
      responseMode: "query",
    });
  }
  return clientPromise;
}

export async function createExtensionAuthorizationUrl(
  handle: string
): Promise<string> {
  const client = await getExtensionOAuthClient();
  const redirectUri = extensionOAuthRedirectUri();
  const url = await client.authorize(handle, {
    scope: AT_PROTO_OAUTH_SCOPES,
    redirect_uri: redirectUri as Parameters<
      BrowserOAuthClient["signInRedirect"]
    >[1] extends { redirect_uri?: infer R } | undefined
      ? R
      : never,
  });
  return url.href;
}

export function readOAuthCallbackParams(): URLSearchParams | null {
  const fromSearch = new URLSearchParams(window.location.search);
  if (
    fromSearch.has("state") &&
    (fromSearch.has("code") || fromSearch.has("error"))
  ) {
    return fromSearch;
  }
  return null;
}

export async function handleExtensionOAuthCallback(): Promise<OAuthSession> {
  const params = readOAuthCallbackParams();
  if (!params) {
    throw new TypeError("No OAuth callback parameters found in the URL");
  }

  clientPromise = null;
  const client = await getExtensionOAuthClient();
  const redirectUri = extensionOAuthRedirectUri();
  const { session } = await client.initCallback(
    params,
    redirectUri as Parameters<BrowserOAuthClient["initCallback"]>[1]
  );
  return session;
}

export async function getExtensionSession(): Promise<OAuthSession | null> {
  try {
    const client = await getExtensionOAuthClient();
    const result = await client.initRestore();
    return result?.session ?? null;
  } catch {
    return null;
  }
}

export async function signOutExtension(): Promise<void> {
  const session = await getExtensionSession();
  if (!session?.did) {
    clientPromise = null;
    return;
  }
  const client = await getExtensionOAuthClient();
  await client.revoke(session.did);
  clientPromise = null;
}
