/**
 * ATProto OAuth — PKCE + DPoP via @atproto/oauth-client-browser.
 *
 * Local dev: the loopback `client_id` must embed `redirect_uri` (and non-default
 * `scope`) — see @atproto/oauth-client-browser README “Using in development”.
 * Bare `http://localhost` defaults to redirect URIs on `/`, not `/callback`.
 */
import { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import { buildAtprotoLoopbackClientId } from "@atproto/oauth-types";

import { BSKY_APPVIEW_PUBLIC } from "@/lib/appview";

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

export const AT_PROTO_OAUTH_SCOPES = [
  "atproto",
  "repo:com.latr.saved.external?action=create&action=update&action=delete",
  "repo:com.latr.saved.item?action=create&action=update&action=delete",
].join(" ");

function resolveOAuthResponseMode(): "fragment" | "query" {
  return process.env.NEXT_PUBLIC_OAUTH_RESPONSE_MODE === "query"
    ? "query"
    : "fragment";
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Use built-in loopback OAuth (no fetch to latr.link) when:
 * - explicitly enabled via env, or
 * - the page host is loopback (localhost / 127.0.0.1 / ::1) — including `next start`
 *   and embedded preview browsers, so we do **not** require NODE_ENV=development.
 */
export function isLocalOAuthMode(): boolean {
  if (
    process.env.NEXT_PUBLIC_APP_ENV === "local" ||
    process.env.NEXT_PUBLIC_ATPROTO_LOCAL === "true"
  ) {
    return true;
  }

  if (
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname)
  ) {
    return true;
  }

  return false;
}

/**
 * Full loopback `client_id` URL (`http://localhost?...`) or hosted metadata URL.
 * Only safe to call in the browser (uses `window.location` for default redirect).
 */
export function resolveClientId(): string {
  const manual = process.env.NEXT_PUBLIC_LOCAL_OAUTH_CLIENT_ID?.trim();
  if (manual) {
    return manual;
  }

  if (!isLocalOAuthMode()) {
    return (
      process.env.NEXT_PUBLIC_ATPROTO_CLIENT_ID ??
      "https://latr.link/client-metadata.json"
    );
  }

  if (typeof window === "undefined") {
    throw new Error(
      "resolveClientId: local OAuth requires the browser (window is undefined). Call from client code only."
    );
  }

  const explicitRedirect = process.env.NEXT_PUBLIC_LOCAL_REDIRECT_URI?.trim();
  const redirectUri = explicitRedirect ?? buildDefaultLocalCallbackUrl();

  return buildAtprotoLoopbackClientId({
    scope: AT_PROTO_OAUTH_SCOPES,
    redirect_uris: [redirectUri],
  });
}

/** `http://127.0.0.1:<port>/callback` matching this tab (maps localhost → 127.0.0.1). */
function buildDefaultLocalCallbackUrl(): string {
  const u = new URL(window.location.href);
  if (u.hostname === "localhost") {
    u.hostname = "127.0.0.1";
  }
  u.pathname = "/callback";
  u.search = "";
  u.hash = "";
  return u.toString();
}

/**
 * Parse OAuth redirect params from the current URL (fragment default, query fallback).
 * Mirrors {@link BrowserOAuthClient.readCallbackParams} without needing a client instance.
 */
function readOAuthCallbackParamsFromWindow(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  const mode = resolveOAuthResponseMode();
  if (mode === "query") {
    const fromSearch = new URLSearchParams(window.location.search);
    if (
      fromSearch.has("state") &&
      (fromSearch.has("code") || fromSearch.has("error"))
    ) {
      return fromSearch;
    }
    return null;
  }
  const fromHash = new URLSearchParams(window.location.hash.slice(1));
  if (
    fromHash.has("state") &&
    (fromHash.has("code") || fromHash.has("error"))
  ) {
    return fromHash;
  }
  const fromSearch = new URLSearchParams(window.location.search);
  if (
    fromSearch.has("state") &&
    (fromSearch.has("code") || fromSearch.has("error"))
  ) {
    return fromSearch;
  }
  return null;
}

/** True on `/callback` when Bluesky has redirected back with OAuth params. */
export function hasPendingOAuthBrowserCallback(): boolean {
  return readOAuthCallbackParamsFromWindow() != null;
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
          `Could not load OAuth client metadata from ${clientId}. For local dev, use a loopback URL (localhost / 127.0.0.1) or set NEXT_PUBLIC_APP_ENV=local in apps/web/.env.local. (${cause})`,
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
