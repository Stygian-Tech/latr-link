import { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";

import {
  assertHostedOAuthClientReady,
  buildDefaultLocalCallbackUrl,
  hasPendingOAuthBrowserCallback,
  readOAuthCallbackParamsFromWindow,
  resolveClientId,
  resolveOAuthResponseMode,
} from "@/lib/authConfig";
import { LATRKIT_DEV_OAUTH_SCOPES } from "@/lib/atprotoOAuthScopes";

const BSKY_APPVIEW = "https://public.api.bsky.app";

let _clientPromise: Promise<BrowserOAuthClient> | null = null;

export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === "undefined") {
    throw new Error("getOAuthClient is browser-only");
  }
  if (!_clientPromise) {
    _clientPromise = BrowserOAuthClient.load({
      clientId: resolveClientId(),
      handleResolver: BSKY_APPVIEW,
      responseMode: resolveOAuthResponseMode(),
    });
  }
  return _clientPromise;
}

export async function signIn(handle: string): Promise<void> {
  await assertHostedOAuthClientReady();
  _clientPromise = null;
  const client = await getOAuthClient();
  await client.signInRedirect(handle, { scope: LATRKIT_DEV_OAUTH_SCOPES });
}

export async function handleCallback(): Promise<OAuthSession> {
  const params = readOAuthCallbackParamsFromWindow();
  if (!params) {
    throw new TypeError("No OAuth callback parameters found in the URL");
  }
  _clientPromise = null;
  const client = await getOAuthClient();
  const redirectUri =
    client.findRedirectUrl() ??
    (process.env.NEXT_PUBLIC_LOCAL_REDIRECT_URI?.trim() ||
      buildDefaultLocalCallbackUrl());
  const { session } = await client.initCallback(
    params,
    redirectUri as Parameters<BrowserOAuthClient["initCallback"]>[1]
  );
  return session;
}

export async function getSession(): Promise<OAuthSession | null> {
  if (hasPendingOAuthBrowserCallback()) return null;
  try {
    const client = await getOAuthClient();
    const result = await client.initRestore();
    return result?.session ?? null;
  } catch {
    return null;
  }
}

export async function signOut(did: string): Promise<void> {
  const client = await getOAuthClient();
  await client.revoke(did);
}
