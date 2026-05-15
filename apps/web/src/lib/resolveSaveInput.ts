/**
 * Decide whether a pasted string should save as a native AT subject or as an external URL.
 */
import { AtUri } from "@atproto/syntax";
import { normalizeUrl } from "latr-kit";

import { publicAppviewAgent } from "@/lib/appview";
import { tryCanonicalAtUri } from "@/lib/canonicalAtUri";

export { tryCanonicalAtUri } from "@/lib/canonicalAtUri";

export type ResolvedSavePaste =
  | {
      kind: "subject";
      subjectUri: string;
      /** HTTP(S) page the user pasted; used for Open Graph snapshot on saved items. */
      discoveryWebUrl?: string;
      via: "at-uri" | "bsky-app" | "standard-site";
    }
  | { kind: "external"; normalizedUrl: string };

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

function discoveryWebUrlFromHttpPaste(httpUrl: URL): string {
  return normalizeUrl(httpUrl.href) ?? httpUrl.href;
}

async function actorToDid(actor: string): Promise<string | null> {
  if (actor.startsWith("did:")) return actor;
  try {
    const res = await publicAppviewAgent.app.bsky.actor.getProfile({
      actor,
    });
    return typeof res?.data?.did === "string" ? res.data.did : null;
  } catch {
    return null;
  }
}

/** Throw if empty or unusable paste; resolves Bluesky URLs to native `at://` when possible */
export async function resolvePasteForSave(
  rawInput: string
): Promise<ResolvedSavePaste> {
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
    throw new Error("Paste a URL (https://…) or at:// URI.");
  }

  const profilePost = extractBskyAppProfilePostParts(httpUrl);
  if (profilePost) {
    const did = await actorToDid(profilePost.actor);
    if (did) {
      const candidate = `at://${did}/app.bsky.feed.post/${profilePost.rkey}`;
      try {
        new AtUri(candidate);
        return {
          kind: "subject",
          subjectUri: candidate,
          discoveryWebUrl: discoveryWebUrlFromHttpPaste(httpUrl),
          via: "bsky-app",
        };
      } catch {
        /* invalid ref — save as plain link */
      }
    }
  }

  try {
    const rr = await fetch(
      `/api/at-uri-from-url?${new URLSearchParams({ url: httpUrl.href }).toString()}`
    );
    if (rr.ok) {
      const data = (await rr.json()) as { subjectUri?: string | null };
      if (data.subjectUri) {
        const canon = tryCanonicalAtUri(data.subjectUri);
        if (canon) {
          return {
            kind: "subject",
            subjectUri: canon,
            discoveryWebUrl: discoveryWebUrlFromHttpPaste(httpUrl),
            via: "standard-site",
          };
        }
      }
    }
  } catch {
    /* non-fatal */
  }

  const normalized = normalizeUrl(httpUrl.href);
  if (!normalized) {
    throw new Error("Invalid or unsupported URL.");
  }

  return { kind: "external", normalizedUrl: normalized };
}
