/**
 * Decide whether a pasted string should save as a native AT subject or as an external URL.
 */
import "./latrGatewayUrl";

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

/** Throw if empty or unusable paste; gateway resolves native subjects for HTTPS URLs. */
export function resolvePasteForSave(rawInput: string): ResolvedSavePaste {
  return sharedResolvePasteForSave(rawInput);
}
