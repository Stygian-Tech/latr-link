import { NextRequest, NextResponse } from "next/server";

import { tryCanonicalAtUri } from "@/lib/canonicalAtUri";
import { fetchUrlBodyLimited } from "@/lib/fetchUrlBodyLimited";
import { blockingReasonOgFetch } from "@/lib/ogFetchGuards";
import { extractSiteStandardDocumentAtUri } from "@/lib/standardSiteAtUri";

export const runtime = "nodejs";

const MAX_HTML_BYTES = 512 * 1024;
const MAX_WELL_KNOWN_BYTES = 4096;

function isPublicationRootPath(u: URL): boolean {
  const norm = u.pathname.replace(/\/+/g, "/").replace(/\/+$/, "");
  return norm === "" || norm === "/";
}

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

  let subjectUri: string | undefined;

  if (!pageFetch.ok) {
    return NextResponse.json({
      subjectUri: null,
      pageFetchWarning: pageFetch.reason,
    });
  }

  const fromHtml = extractSiteStandardDocumentAtUri(pageFetch.text);
  if (fromHtml) {
    subjectUri = fromHtml;
  }

  /** Publication home only ({@link https://standard.site/} — avoids saving publication AT instead of article) */
  if (!subjectUri) {
    const final = new URL(pageFetch.finalUrl);
    if (isPublicationRootPath(final)) {
      const wkHref = `${final.origin}/.well-known/site.standard.publication`;
      const wk = await fetchUrlBodyLimited(wkHref, {
        maxBytes: MAX_WELL_KNOWN_BYTES,
        accept: "text/plain,*/*",
      });
      if (wk.ok) {
        const line = wk.text.trim().split(/\r?\n/).find(Boolean);
        if (line) {
          const canon = tryCanonicalAtUri(line.trim());
          if (canon) subjectUri = canon;
        }
      }
    }
  }

  return NextResponse.json({
    subjectUri: subjectUri ?? null,
  });
}
