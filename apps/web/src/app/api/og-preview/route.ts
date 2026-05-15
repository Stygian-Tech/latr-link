import { NextRequest, NextResponse } from "next/server";

import { fetchUrlBodyLimited } from "@/lib/fetchUrlBodyLimited";
import { blockingReasonOgFetch } from "@/lib/ogFetchGuards";
import { parseOpenGraphMarkup } from "@/lib/openGraph";

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;

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

  const fetched = await fetchUrlBodyLimited(url.href, { maxBytes: MAX_BYTES });
  if (!fetched.ok) {
    return NextResponse.json(
      { error: fetched.reason },
      { status: fetched.reason.startsWith("http_") ? 502 : 400 }
    );
  }

  const parsed = parseOpenGraphMarkup(fetched.text, fetched.finalUrl);
  return NextResponse.json(parsed);
}
