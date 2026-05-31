import { NextRequest, NextResponse } from "next/server";

import { fetchUrlBodyLimited } from "@/lib/fetchUrlBodyLimited";
import { blockingReasonOgFetch } from "@/lib/ogFetchGuards";
import { extractAtUriFromHead } from "@/lib/standardSiteAtUri";

export const runtime = "nodejs";

const MAX_HTML_BYTES = 512 * 1024;

/** Local-dev fallback for HEAD AT URI discovery (gateway owns save-time discovery). */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw?.trim()) {
    return NextResponse.json({ error: "missing_url" }, { status: 400 });
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return NextResponse.json({ error: "unsupported_scheme" }, { status: 400 });
  }

  const block = blockingReasonOgFetch(pageUrl.hostname);
  if (block) {
    return NextResponse.json({ error: block }, { status: 400 });
  }

  const pageFetch = await fetchUrlBodyLimited(pageUrl.href, {
    maxBytes: MAX_HTML_BYTES,
  });

  if (!pageFetch.ok) {
    return NextResponse.json({
      subjectUri: null,
      pageFetchWarning: pageFetch.reason,
    });
  }

  return NextResponse.json({
    subjectUri: extractAtUriFromHead(pageFetch.text),
  });
}
