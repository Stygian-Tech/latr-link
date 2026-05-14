import { buildAtprotoLoopbackClientId } from "@atproto/oauth-types";

export const AT_PROTO_OAUTH_SCOPES = [
  "atproto",
  "repo:com.latr.saved.external?action=create&action=update&action=delete",
  "repo:com.latr.saved.item?action=create&action=update&action=delete",
].join(" ");

export function resolveOAuthResponseMode(): "fragment" | "query" {
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
export function buildDefaultLocalCallbackUrl(): string {
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
 * Mirrors BrowserOAuthClient.readCallbackParams without needing a client instance.
 */
export function readOAuthCallbackParamsFromWindow(): URLSearchParams | null {
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
