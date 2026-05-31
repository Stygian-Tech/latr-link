import type { OAuthSession } from "@atproto/oauth-client-browser";

import { LatrRepo } from "./latrRepo";
import { resolvePasteForSave, type ResolvePasteOptions } from "./resolveSaveInput";

const UNSUPPORTED_TAB_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "moz-extension://",
  "safari-extension://",
  "brave://",
  "devtools://",
];

export function isSupportedSaveUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (UNSUPPORTED_TAB_URL_PREFIXES.some((p) => lower.startsWith(p))) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export type SaveCurrentUrlResult =
  | { ok: true; kind: "subject" | "external" }
  | { ok: false; message: string };

export async function saveCurrentUrl(
  url: string,
  oauthSession: OAuthSession,
  resolveOptions: Omit<ResolvePasteOptions, "oauthSession"> = {}
): Promise<SaveCurrentUrlResult> {
  if (!isSupportedSaveUrl(url)) {
    return {
      ok: false,
      message: "This Page Cannot Be Saved (Browser-Internal or Invalid URL).",
    };
  }

  const did = oauthSession.did;
  if (!did) {
    return { ok: false, message: "Sign In to Save Links." };
  }

  try {
    const resolved = await resolvePasteForSave(url, {
      ...resolveOptions,
      oauthSession,
    });
    const repo = new LatrRepo(oauthSession, did);
    if (resolved.kind === "subject") {
      await repo.saveSubjectUri(resolved.subjectUri, {
        linkedWebUrl: resolved.discoveryWebUrl,
      });
      return { ok: true, kind: "subject" };
    }
    await repo.saveExternalUrl(resolved.url);
    return { ok: true, kind: "external" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could Not Save This Link.",
    };
  }
}
