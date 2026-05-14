import { NextRequest, NextResponse } from "next/server";

import { parseOpenGraphMarkup } from "@/lib/openGraph";
import { blockingReasonOgFetch } from "@/lib/ogFetchGuards";

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (compatible; L@tr.link/1.0; +https://latr.link) AppleWebKit/537.36 (KHTML, like Gecko)";
const MAX_BYTES = 512 * 1024;
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

async function fetchHtmlLimited(target: string): Promise<
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: string }
> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
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

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      let chunk = value;
      if (total + chunk.length > MAX_BYTES) {
        chunk = chunk.subarray(0, MAX_BYTES - total);
      }
      chunks.push(chunk);
      total += chunk.length;
      if (total >= MAX_BYTES) {
        void reader.cancel();
        break;
      }
    }

    const merged = mergeChunks(chunks, total);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(merged);
    return { ok: true, html, finalUrl };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "fetch_error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "missing_url" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "unsupported_scheme" }, { status: 400 });
  }

  const block = blockingReasonOgFetch(url.hostname);
  if (block) {
    return NextResponse.json({ error: block }, { status: 400 });
  }

  const fetched = await fetchHtmlLimited(url.href);
  if (!fetched.ok) {
    return NextResponse.json(
      { error: fetched.reason },
      { status: fetched.reason.startsWith("http_") ? 502 : 400 }
    );
  }

  const parsed = parseOpenGraphMarkup(fetched.html, fetched.finalUrl);
  return NextResponse.json(parsed);
}
