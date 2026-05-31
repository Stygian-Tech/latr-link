/**
 * Validate pasted save input for thin clients (gateway owns discovery).
 */
import { tryCanonicalAtUri } from "./canonicalAtUri";

export { tryCanonicalAtUri } from "./canonicalAtUri";

/** Public Bluesky AppView base URL (shared with OAuth handle resolution). */
export const BSKY_APPVIEW_PUBLIC = "https://public.api.bsky.app";

export type ResolvedSavePaste =
  | {
      kind: "subject";
      subjectUri: string;
      via: "at-uri";
    }
  | { kind: "url"; url: string };

/** `https:` / `http:` URL, optionally prepending https when no scheme */
export function tryParseHttpUrl(trimmedInput: string): URL | null {
  const trimmed = trimmedInput.trim();
  if (!trimmed) return null;
  try {
    return trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * Parses `…/profile/{actor}/post/{rkey}` on bsky hostnames (e.g. bsky.app, *.bsky.app).
 * Kept for tests and optional client-side display helpers.
 */
export function extractBskyAppProfilePostParts(
  url: URL
): { actor: string; rkey: string } | null {
  const host = url.hostname.toLowerCase();
  if (host !== "bsky.app" && !host.endsWith(".bsky.app")) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 4 ||
    segments[0] !== "profile" ||
    segments[2] !== "post"
  ) {
    return null;
  }

  const actor = decodeURIComponent(segments[1]).trim();
  const rkey = decodeURIComponent(segments[3]).trim();
  return actor.length && rkey.length ? { actor, rkey } : null;
}

/** Throw if empty or unusable paste; gateway resolves native subjects for HTTPS URLs. */
export function resolvePasteForSave(rawInput: string): ResolvedSavePaste {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("Enter a URL or at:// URI.");
  }

  const atUriDirect = tryCanonicalAtUri(trimmed);
  if (atUriDirect) {
    return { kind: "subject", subjectUri: atUriDirect, via: "at-uri" };
  }

  const httpUrl = tryParseHttpUrl(trimmed);
  if (
    !httpUrl ||
    (httpUrl.protocol !== "http:" && httpUrl.protocol !== "https:")
  ) {
    throw new Error("Paste A URL (https://…) or at:// URI.");
  }

  return { kind: "url", url: httpUrl.href };
}
