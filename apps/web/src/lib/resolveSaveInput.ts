/**
 * Decide whether a pasted string should save as a native AT subject or as an external URL.
 */
import "./latrGatewayUrl";

import type { OAuthSession } from "@atproto/oauth-client-browser";

import {
  resolvePasteForSave as sharedResolvePasteForSave,
  tryCanonicalAtUri,
  tryParseHttpUrl,
  extractBskyAppProfilePostParts,
  type ResolvedSavePaste,
} from "latr-web-client/resolveSaveInput";

export {
  tryCanonicalAtUri,
  tryParseHttpUrl,
  extractBskyAppProfilePostParts,
  type ResolvedSavePaste,
};

/** Throw if empty or unusable paste; resolves Bluesky URLs to native `at://` when possible */
export async function resolvePasteForSave(
  rawInput: string,
  oauthSession?: OAuthSession | null
): Promise<ResolvedSavePaste> {
  return sharedResolvePasteForSave(rawInput, {
    oauthSession,
    discoverAtUriWithoutSession: oauthSession
      ? undefined
      : async (httpUrl) => {
          const res = await fetch(
            `/api/at-uri-from-url?${new URLSearchParams({ url: httpUrl.href }).toString()}`
          );
          if (!res.ok) return null;
          const data = (await res.json()) as { subjectUri?: string | null };
          return data.subjectUri ?? null;
        },
  });
}
