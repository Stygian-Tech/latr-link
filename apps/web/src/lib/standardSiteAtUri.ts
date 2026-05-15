/**
 * Resolve Standard.site HTTPS documents to canonical `at://` subject URIs per
 * {@link https://standard.site/#verification}.
 */
import { tryCanonicalAtUri } from "@/lib/canonicalAtUri";

function decodeMinimalHref(s: string): string {
  return s
    .trim()
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

function sliceForEarlyHeadMarkup(html: string): string {
  const lower = html.toLowerCase();
  const idx = lower.indexOf("</head>");
  if (idx !== -1) {
    return html.slice(0, idx + "</head>".length);
  }
  return html.length > 300_000 ? html.slice(0, 300_000) : html;
}

/** Extract `<link rel="site.standard.document" href="at://…">` when present */
export function extractSiteStandardDocumentAtUri(html: string): string | null {
  const scope = sliceForEarlyHeadMarkup(html);

  const relFirst =
    /<link\b[^>]*?\brel\s*=\s*["']site\.standard\.document["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/i.exec(
      scope
    );

  const hrefFirst =
    /<link\b[^>]*?\bhref\s*=\s*["'](at:\/\/[^"']+)["'][^>]*?\brel\s*=\s*["']site\.standard\.document["'][^>]*>/i.exec(
      scope
    );

  const raw = hrefFirst?.[1] ?? relFirst?.[1];
  if (!raw) return null;

  const cleaned = decodeMinimalHref(raw);
  return tryCanonicalAtUri(cleaned);
}
