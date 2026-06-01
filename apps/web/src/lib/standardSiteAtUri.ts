/**
 * Resolve HTTPS documents to canonical `at://` subject URIs from early `<head>` markup.
 */
import { tryCanonicalAtUri } from "@/lib/canonicalAtUri";
import { decodeHtmlText } from "@/lib/decodeHtmlText";
import { isLatrExternalWrapperCollection } from "@/lib/latrRecords";

function decodeMinimalHref(s: string): string {
  return decodeHtmlText(s.trim());
}

function sliceForEarlyHeadMarkup(html: string): string {
  const lower = html.toLowerCase();
  const idx = lower.indexOf("</head>");
  if (idx !== -1) {
    return html.slice(0, idx + "</head>".length);
  }
  return html.length > 300_000 ? html.slice(0, 300_000) : html;
}

function collectionFromAtUri(uri: string): string | null {
  if (!uri.startsWith("at://")) return null;
  const parts = uri.slice("at://".length).split("/");
  return parts[1] ?? null;
}

/** Extract the first canonical native `at://` URI from early `<head>` markup. */
export function extractAtUriFromHead(html: string): string | null {
  const scope = sliceForEarlyHeadMarkup(html);
  const candidates: { index: number; uri: string }[] = [];

  const linkPattern =
    /<link\b[^>]*?\bhref\s*=\s*["'](at:\/\/[^"']+)["'][^>]*>/gi;
  for (const match of scope.matchAll(linkPattern)) {
    const cleaned = decodeMinimalHref(match[1]);
    const canonical = tryCanonicalAtUri(cleaned);
    if (canonical && match.index !== undefined) {
      candidates.push({ index: match.index, uri: canonical });
    }
  }

  const metaPattern =
    /<meta\b[^>]*?\bcontent\s*=\s*["'](at:\/\/[^"']+)["'][^>]*>/gi;
  for (const match of scope.matchAll(metaPattern)) {
    const cleaned = decodeMinimalHref(match[1]);
    const canonical = tryCanonicalAtUri(cleaned);
    if (canonical && match.index !== undefined) {
      candidates.push({ index: match.index, uri: canonical });
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  const native = candidates.find(
    (c) => !isLatrExternalWrapperCollection(collectionFromAtUri(c.uri) ?? "")
  );
  return native?.uri ?? candidates[0]?.uri ?? null;
}

/** @deprecated Use {@link extractAtUriFromHead} */
export function extractSiteStandardDocumentAtUri(html: string): string | null {
  return extractAtUriFromHead(html);
}
