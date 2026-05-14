/** Parsed Open Graph / Twitter Card fields for embedding saved links (issue #2). */

export interface OpenGraphFields {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}

/** Match head section when present — keeps parsing noise down. */
function sliceForMarkup(html: string): string {
  const lower = html.toLowerCase();
  const headOpen = lower.indexOf("<head");
  const headClose = lower.indexOf("</head>");
  if (headOpen >= 0 && headClose > headOpen) {
    return html.slice(headOpen, headClose + "</head>".length);
  }
  return html;
}

function escapeRegExp(s: string): string {
  return s.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}

function stripWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function decodeMinimalEntities(s: string): string {
  return s
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&amp;/gi, "&");
}

function normalizeMetaValue(s: string): string | undefined {
  const t = stripWhitespace(s);
  return t.length ? t : undefined;
}

function metaTagContent(
  scope: string,
  kind: "property" | "name",
  key: string
): string | undefined {
  const escaped = escapeRegExp(key);
  const patterns = [
    new RegExp(
      `<meta\\s[^>]*?${kind}=["']${escaped}["'][^>]*?content=["']([^"']*)["'][^>]*?>`,
      "i"
    ),
    new RegExp(
      `<meta\\s[^>]*?content=["']([^"']*)["'][^>]*?${kind}=["']${escaped}["'][^>]*?>`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(scope);
    if (m?.[1]) return normalizeMetaValue(decodeMinimalEntities(m[1]));
  }
  return undefined;
}

/** First capturing group inside <title>...</title>. */
function parseDocumentTitle(html: string): string | undefined {
  const m =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ??
    /<title[^>]*>([\s\S]*?)<\/title[^>]*>/i.exec(html);
  if (!m?.[1]) return undefined;
  return normalizeMetaValue(
    decodeMinimalEntities(m[1].replace(/<[^>]+>/g, ""))
  );
}

function toAbsoluteHref(resolvedPageUrl: string, raw: string): string | undefined {
  const t = normalizeMetaValue(decodeMinimalEntities(stripWhitespace(raw)));
  if (!t) return undefined;
  try {
    return new URL(t, resolvedPageUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * Parse Open Graph and Twitter fallback metadata from HTML.
 * Relative `og:image` values are resolved against `resolvedPageUrl` (typically the redirect-final URL).
 */
export function parseOpenGraphMarkup(
  html: string,
  resolvedPageUrl: string
): OpenGraphFields {
  const slice = sliceForMarkup(html);

  const title =
    metaTagContent(slice, "property", "og:title") ??
    metaTagContent(slice, "name", "twitter:title") ??
    parseDocumentTitle(slice);

  const description =
    metaTagContent(slice, "property", "og:description") ??
    metaTagContent(slice, "name", "twitter:description") ??
    metaTagContent(slice, "name", "description");

  const siteName = metaTagContent(slice, "property", "og:site_name");

  const author =
    metaTagContent(slice, "property", "article:author") ??
    metaTagContent(slice, "name", "author");

  const imgRaw =
    metaTagContent(slice, "property", "og:image") ??
    metaTagContent(slice, "name", "twitter:image");
  const image = imgRaw ? toAbsoluteHref(resolvedPageUrl, imgRaw) ?? imgRaw : undefined;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName } : {}),
    ...(author ? { author } : {}),
  };
}
