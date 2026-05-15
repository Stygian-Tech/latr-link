import { AtUri } from "@atproto/syntax";

/** Canonical `at://` with repo + collection + rkey when input is valid. */
export function tryCanonicalAtUri(trimmedInput: string): string | null {
  const trimmed = trimmedInput.trim();
  if (!trimmed.startsWith("at://")) return null;

  try {
    const uri = new AtUri(trimmed);
    if (!uri.hostname || !uri.collection || !uri.rkey) {
      return null;
    }
    return uri.toString();
  } catch {
    return null;
  }
}
