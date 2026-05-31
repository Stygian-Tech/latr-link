import Foundation

public struct OpenGraphFields: Codable, Sendable, Equatable {
    public var title: String?
    public var description: String?
    public var image: String?
    public var siteName: String?
    public var author: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        image: String? = nil,
        siteName: String? = nil,
        author: String? = nil
    ) {
        self.title = title
        self.description = description
        self.image = image
        self.siteName = siteName
        self.author = author
    }
}

private func sliceForMarkup(_ html: String) -> String {
    let lower = html.lowercased()
    if let headOpen = lower.range(of: "<head"),
       let headClose = lower.range(of: "</head>")
    {
        let end = html.index(headClose.upperBound, offsetBy: 0, limitedBy: html.endIndex) ?? html.endIndex
        return String(html[headOpen.lowerBound ..< end])
    }
    return html
}

private func escapeRegExp(_ string: String) -> String {
    NSRegularExpression.escapedPattern(for: string)
}

private func stripWhitespace(_ string: String) -> String {
    string.trimmingCharacters(in: .whitespacesAndNewlines)
        .split(whereSeparator: \.isWhitespace)
        .joined(separator: " ")
}

private func decodeMinimalEntities(_ string: String) -> String {
    HtmlTextDecoder.decode(string)
}

private func normalizeMetaValue(_ string: String) -> String? {
    let trimmed = stripWhitespace(string)
    return trimmed.isEmpty ? nil : trimmed
}

private func metaTagContent(scope: String, kind: String, key: String) -> String? {
    let escaped = escapeRegExp(key)
    let patterns = [
        #"<meta\s[^>]*?\#(kind)=["']\#(escaped)["'][^>]*?content=["']([^"']*)["'][^>]*?>"#,
        #"<meta\s[^>]*?content=["']([^"']*)["'][^>]*?\#(kind)=["']\#(escaped)["'][^>]*?>"#,
    ]

    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(scope.startIndex..., in: scope)
        if let match = regex.firstMatch(in: scope, range: range),
           let capture = Range(match.range(at: 1), in: scope)
        {
            return normalizeMetaValue(decodeMinimalEntities(String(scope[capture])))
        }
    }
    return nil
}

private func linkTagAttribute(scope: String, rel: String, attribute: String) -> String? {
    let escapedRel = escapeRegExp(rel)
    let escapedAttribute = escapeRegExp(attribute)
    let patterns = [
        #"<link\s[^>]*?rel=["']\#(escapedRel)["'][^>]*?\#(escapedAttribute)=["']([^"']*)["'][^>]*?>"#,
        #"<link\s[^>]*?\#(escapedAttribute)=["']([^"']*)["'][^>]*?rel=["']\#(escapedRel)["'][^>]*?>"#,
    ]

    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(scope.startIndex..., in: scope)
        if let match = regex.firstMatch(in: scope, range: range),
           let capture = Range(match.range(at: 1), in: scope)
        {
            return normalizeMetaValue(decodeMinimalEntities(String(scope[capture])))
        }
    }
    return nil
}

private func normalizeAuthorValue(_ raw: String?) -> String? {
    guard let raw else { return nil }
    let trimmed = stripWhitespace(raw)
    guard !trimmed.isEmpty else { return nil }
    let lower = trimmed.lowercased()
    if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
        return nil
    }
    return trimmed
}

private func firstDefined(_ values: [String?]) -> String? {
    for value in values {
        if let value { return value }
    }
    return nil
}

private func parseDocumentTitle(_ html: String) -> String? {
    let patterns = [
        #"<title[^>]*>([\s\S]*?)</title>"#,
        #"<title[^>]*>([\s\S]*?)<\/title[^>]*>"#,
    ]
    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(html.startIndex..., in: html)
        if let match = regex.firstMatch(in: html, range: range),
           let capture = Range(match.range(at: 1), in: html)
        {
            let raw = String(html[capture]).replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            return normalizeMetaValue(decodeMinimalEntities(raw))
        }
    }
    return nil
}

private func parseJsonLdAuthor(_ html: String) -> String? {
    guard let scriptRegex = try? NSRegularExpression(
        pattern: #"<script[^>]*type=["']application/ld\+json["'][^>]*>([\s\S]*?)</script>"#,
        options: [.caseInsensitive]
    ) else {
        return nil
    }

    let authorPatterns = [
        #""author"\s*:\s*\[\s*\{[^}]*"name"\s*:\s*"([^"]+)""#,
        #""author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)""#,
        #""author"\s*:\s*"([^"]+)""#,
    ]
    let authorRegexes = authorPatterns.compactMap {
        try? NSRegularExpression(pattern: $0, options: [.caseInsensitive])
    }

    let range = NSRange(html.startIndex..., in: html)
    let matches = scriptRegex.matches(in: html, range: range)
    for match in matches {
        guard let blockRange = Range(match.range(at: 1), in: html) else { continue }
        let block = String(html[blockRange])
        for authorRegex in authorRegexes {
            let blockNSRange = NSRange(block.startIndex..., in: block)
            if let authorMatch = authorRegex.firstMatch(in: block, range: blockNSRange),
               let capture = Range(authorMatch.range(at: 1), in: block),
               let author = normalizeAuthorValue(String(block[capture]))
            {
                return author
            }
        }
    }

    return nil
}

private func toAbsoluteHref(resolvedPageURL: String, raw: String) -> String? {
    guard let normalized = normalizeMetaValue(decodeMinimalEntities(stripWhitespace(raw))) else {
        return nil
    }
    if let url = URL(string: normalized, relativeTo: URL(string: resolvedPageURL)) {
        return url.absoluteString
    }
    return nil
}

private func parseImage(scope: String, resolvedPageURL: String) -> String? {
    let imageRaw = firstDefined([
        metaTagContent(scope: scope, kind: "property", key: "og:image"),
        metaTagContent(scope: scope, kind: "property", key: "og:image:secure_url"),
        metaTagContent(scope: scope, kind: "property", key: "og:image:url"),
        metaTagContent(scope: scope, kind: "name", key: "twitter:image"),
        metaTagContent(scope: scope, kind: "name", key: "twitter:image:src"),
        linkTagAttribute(scope: scope, rel: "image_src", attribute: "href"),
    ])

    guard let imageRaw else { return nil }
    return toAbsoluteHref(resolvedPageURL: resolvedPageURL, raw: imageRaw) ?? imageRaw
}

private func parseAuthor(scope: String, html: String) -> String? {
    firstDefined([
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "property", key: "og:author")),
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "name", key: "author")),
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "property", key: "article:author")),
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "name", key: "twitter:creator")),
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "name", key: "dc.creator")),
        normalizeAuthorValue(metaTagContent(scope: scope, kind: "name", key: "DC.creator")),
        normalizeAuthorValue(linkTagAttribute(scope: scope, rel: "author", attribute: "title")),
        parseJsonLdAuthor(html),
    ])
}

private func parseJsonLdMetadata(_ html: String) -> (title: String?, image: String?) {
    guard let scriptRegex = try? NSRegularExpression(
        pattern: #"<script[^>]*type=["']application/ld\+json["'][^>]*>([\s\S]*?)</script>"#,
        options: [.caseInsensitive]
    ) else {
        return (nil, nil)
    }

    let titlePatterns = [
        #""headline"\s*:\s*"([^"]+)""#,
        #""title"\s*:\s*"([^"]+)""#,
    ]
    let imagePatterns = [
        #""image"\s*:\s*"([^"]+)""#,
        #""image"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)""#,
        #""thumbnailUrl"\s*:\s*"([^"]+)""#,
    ]
    let titleRegexes = titlePatterns.compactMap {
        try? NSRegularExpression(pattern: $0, options: [.caseInsensitive])
    }
    let imageRegexes = imagePatterns.compactMap {
        try? NSRegularExpression(pattern: $0, options: [.caseInsensitive])
    }

    var title: String?
    var image: String?
    let range = NSRange(html.startIndex..., in: html)
    let matches = scriptRegex.matches(in: html, range: range)

    for match in matches {
        guard let blockRange = Range(match.range(at: 1), in: html) else { continue }
        let block = String(html[blockRange])
        let blockNSRange = NSRange(block.startIndex..., in: block)

        if title == nil {
            for regex in titleRegexes {
                if let titleMatch = regex.firstMatch(in: block, range: blockNSRange),
                   let capture = Range(titleMatch.range(at: 1), in: block),
                   let parsed = normalizeMetaValue(String(block[capture]))
                {
                    title = parsed
                    break
                }
            }
        }

        if image == nil {
            for regex in imageRegexes {
                if let imageMatch = regex.firstMatch(in: block, range: blockNSRange),
                   let capture = Range(imageMatch.range(at: 1), in: block),
                   let parsed = normalizeMetaValue(String(block[capture]))
                {
                    image = parsed
                    break
                }
            }
        }

        if title != nil, image != nil { break }
    }

    return (title, image)
}

private func mergeFields(_ primary: OpenGraphFields, fallback: OpenGraphFields) -> OpenGraphFields {
    OpenGraphFields(
        title: primary.title ?? fallback.title,
        description: primary.description ?? fallback.description,
        image: primary.image ?? fallback.image,
        siteName: primary.siteName ?? fallback.siteName,
        author: primary.author ?? fallback.author
    )
}

private func parseOpenGraphFields(in scope: String, html: String, resolvedPageURL: String) -> OpenGraphFields {
    let jsonLd = parseJsonLdMetadata(html)

    let title = firstDefined([
        metaTagContent(scope: scope, kind: "property", key: "og:title"),
        metaTagContent(scope: scope, kind: "name", key: "twitter:title"),
        jsonLd.title,
        parseDocumentTitle(scope),
    ])

    let description = metaTagContent(scope: scope, kind: "property", key: "og:description")
        ?? metaTagContent(scope: scope, kind: "name", key: "twitter:description")
        ?? metaTagContent(scope: scope, kind: "name", key: "description")

    let siteName = metaTagContent(scope: scope, kind: "property", key: "og:site_name")

    var image = parseImage(scope: scope, resolvedPageURL: resolvedPageURL)
    if image == nil, let jsonImage = jsonLd.image {
        image = toAbsoluteHref(resolvedPageURL: resolvedPageURL, raw: jsonImage) ?? jsonImage
    }

    return OpenGraphFields(
        title: title,
        description: description,
        image: image,
        siteName: siteName,
        author: parseAuthor(scope: scope, html: html)
    )
}

public func parseOpenGraphMarkup(html: String, resolvedPageURL: String) -> OpenGraphFields {
    let headSlice = sliceForMarkup(html)
    let fromHead = parseOpenGraphFields(in: headSlice, html: html, resolvedPageURL: resolvedPageURL)

    if fromHead.title != nil, fromHead.image != nil {
        return fromHead
    }

    let fromDocument = parseOpenGraphFields(in: html, html: html, resolvedPageURL: resolvedPageURL)
    return mergeFields(fromHead, fallback: fromDocument)
}

/// HEAD-only Open Graph parse for the unified save pipeline (no full-document fallback).
public func parseOpenGraphFromHeadOnly(html: String, resolvedPageURL: String) -> OpenGraphFields {
    let headSlice = sliceForMarkup(html)
    return parseOpenGraphFields(in: headSlice, html: headSlice, resolvedPageURL: resolvedPageURL)
}
