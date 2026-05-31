/**
 * ATProto OAuth — PKCE + DPoP via @atproto/oauth-client-browser.
 *
 * Local dev: the loopback `client_id` must embed `redirect_uri` (and non-default
 * `scope`) — see @atproto/oauth-client-browser README “Using in development”.
 * Bare `http://localhost` defaults to redirect URIs on `/`, not `/callback`.
 */
import { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";

import { BSKY_APPVIEW_PUBLIC } from "@/lib/appview";
import {
  AT_PROTO_OAUTH_SCOPES,
  buildDefaultLocalCallbackUrl,
  hasPendingOAuthBrowserCallback,
  readOAuthCallbackParamsFromWindow,
  resolveClientId,
  resolveOAuthResponseMode,
} from "@/lib/authConfig";

export {
  AT_PROTO_OAUTH_SCOPES,
  hasPendingOAuthBrowserCallback,
  isLocalOAuthMode,
  resolveClientId,
} from "@/lib/authConfig";

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

let _clientPromise: Promise<BrowserOAuthClient> | null = null;

const OAUTH_CLIENT_LOAD_TIMEOUT_MS =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS
    ? Math.max(
        4000,
        Number.parseInt(process.env.NEXT_PUBLIC_OAUTH_CLIENT_LOAD_TIMEOUT_MS, 10) ||
          10_000
      )
    : 10_000;

/** Per-request ceiling for OAuth token + metadata fetches (native fetch has no default timeout). */
const OAUTH_FETCH_DEADLINE_MS =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_OAUTH_FETCH_DEADLINE_MS
    ? Math.max(
        15_000,
        Number.parseInt(process.env.NEXT_PUBLIC_OAUTH_FETCH_DEADLINE_MS, 10) ||
          90_000
      )
    : 90_000;
/** Overall ceiling for initCallback (IDB + token exchange + issuer verification). */
export const OAUTH_CALLBACK_TIMEOUT_MS =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT_MS
    ? Math.max(
        15_000,
        Number.parseInt(process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT_MS, 10) ||
          60_000
      )
    : 60_000;

export async function getOAuthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === "undefined") {
    throw new Error("getOAuthClient is browser-only");
  }
  if (!_clientPromise) {
    const load = BrowserOAuthClient.load({
      clientId: resolveClientId(),
      handleResolver: BSKY_APPVIEW_PUBLIC,
      fetch: createFetchWithDeadline(OAUTH_FETCH_DEADLINE_MS),
      responseMode: resolveOAuthResponseMode(),
    });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("OAuth client load timed out"));
      }, OAUTH_CLIENT_LOAD_TIMEOUT_MS);
    });
    _clientPromise = Promise.race([load, timeout]).catch((err: unknown) => {
      _clientPromise = null;
      const cause = err instanceof Error ? err.message : String(err);
      const clientId = resolveClientId();
      if (
        clientId.startsWith("https:") &&
        String(cause).toLowerCase().includes("fetch")
      ) {
        throw new Error(
          `Could Not Load OAuth Client Metadata From ${clientId}. For Local Dev, Use a Loopback URL (localhost / 127.0.0.1) or Set NEXT_PUBLIC_APP_ENV=local in apps/web/.env.local. (${cause})`,
          { cause: err }
        );
      }
      throw err instanceof Error ? err : new Error(cause);
    });
  }
  return _clientPromise;
}

export async function signIn(handle: string): Promise<void> {
  const client = await getOAuthClient();
  await client.signInRedirect(handle, {
    scope: AT_PROTO_OAUTH_SCOPES,
  });
}

let handleCallbackInflight: Promise<OAuthSession> | null = null;

export async function handleCallback(): Promise<OAuthSession> {
  if (handleCallbackInflight) return handleCallbackInflight;

  handleCallbackInflight = (async () => {
    // Snapshot before any await: `initRestore()` can run fixLocation() and replace
    // `http://localhost/...#...` with `http://127.0.0.1/...` without the fragment.
    const params = readOAuthCallbackParamsFromWindow();
    if (!params) {
      throw new TypeError("No OAuth callback parameters found in the URL");
    }

    const work = (async () => {
      // Fresh load for the token exchange — avoids a stuck singleton / IDB edge case.
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
    })();

    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `OAuth callback timed out after ${OAUTH_CALLBACK_TIMEOUT_MS}ms (token exchange or browser storage)`
            )
          );
        }, OAUTH_CALLBACK_TIMEOUT_MS);
      }),
    ]);
  })();

  try {
    return await handleCallbackInflight;
  } finally {
    handleCallbackInflight = null;
  }
}

/** Default 8s — embedded browsers can stall IndexedDB; pair with AuthProvider failsafe. */
const SESSION_RESTORE_TIMEOUT_MS =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS
    ? Math.max(
        2000,
        Number.parseInt(process.env.NEXT_PUBLIC_AUTH_RESTORE_TIMEOUT_MS, 10) ||
          8000
      )
    : 8000;

async function restoreSessionFromStore(): Promise<OAuthSession | null> {
  try {
    // While the OAuth redirect is in the URL, skip `initRestore()`: it calls
    // `fixLocation()` which may navigate localhost → 127.0.0.1 and **drop the hash**
    // (state/code) before `/callback` runs `initCallback()` (parent effects run first).
    if (hasPendingOAuthBrowserCallback()) {
      return null;
    }

    const client = await getOAuthClient();
    // Must NOT use client.init(): it processes OAuth callback params in the URL and
    // races with `/callback` → initCallback (duplicate exchange / unknown state / hang).
    // Restoring sessions only — callback route owns handleCallback().
    const result = await client.initRestore();
    if (!result) return null;
    return result.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Restores OAuth session from IndexedDB. Races with a timeout so the app never
 * spins forever if `client.initRestore()` hangs (e.g. embedded browser, blocked IDB).
 */
export async function getSession(): Promise<OAuthSession | null> {
  return Promise.race([
    restoreSessionFromStore(),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), SESSION_RESTORE_TIMEOUT_MS)
    ),
  ]);
}

export async function signOut(did: string): Promise<void> {
  const client = await getOAuthClient();
  await client.revoke(did);
}

export function createAuthFetch(
  session: OAuthSession
): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init) => session.fetchHandler(url, init);
}
