/**
 * SSRF-checked, size-capped outbound HTTP reads for OG and AT URI discovery.
 */

import { blockingReasonOgFetch } from "@/lib/ogFetchGuards";

const UA =
  "Mozilla/5.0 (compatible; L@tr.link/1.0; +https://latr.link) AppleWebKit/537.36 (KHTML, like Gecko)";
const FETCH_TIMEOUT_MS = 10_000;

function mergeChunks(chunks: Uint8Array[], totalLen: number): Uint8Array {
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out;
}

export async function fetchUrlBodyLimited(
  target: string,
  options: {
    maxBytes: number;
    /** Optional Accept header (defaults to permissive GET) */
    accept?: string;
  }
): Promise<
  | { ok: true; text: string; finalUrl: string }
  | { ok: false; reason: string }
> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "unsupported_scheme" };
    }

    const blockInitial = blockingReasonOgFetch(parsed.hostname);
    if (blockInitial) {
      return { ok: false, reason: blockInitial };
    }

    const res = await fetch(target, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        Accept:
          options.accept ??
          "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": UA,
      },
    });

    const finalUrl = res.url;
    let finalHost: string;
    try {
      finalHost = new URL(finalUrl).hostname;
    } catch {
      return { ok: false, reason: "invalid_final_url" };
    }
    const redirBlock = blockingReasonOgFetch(finalHost);
    if (redirBlock) {
      return { ok: false, reason: "blocked_redirect" };
    }

    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: false, reason: "no_body" };
    }

    const { maxBytes } = options;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      let chunk = value;
      if (total + chunk.length > maxBytes) {
        chunk = chunk.subarray(0, maxBytes - total);
      }
      chunks.push(chunk);
      total += chunk.length;
      if (total >= maxBytes) {
        void reader.cancel();
        break;
      }
    }

    const merged = mergeChunks(chunks, total);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    return { ok: true, text, finalUrl };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}
