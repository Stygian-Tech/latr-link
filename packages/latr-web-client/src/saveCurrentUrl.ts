import type { OAuthSession } from "@atproto/oauth-client-browser";

import { LatrRepo } from "./latrRepo";

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
  | {
      ok: true;
      kind: "bookmark";
    }
  | { ok: false; message: string };

export async function saveCurrentUrl(
  url: string,
  oauthSession: OAuthSession
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
    const repo = new LatrRepo(oauthSession, did);
    const response = await repo.saveUrl(url.trim());
    return {
      ok: true,
      kind: response.kind,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could Not Save This Link.",
    };
  }
}
