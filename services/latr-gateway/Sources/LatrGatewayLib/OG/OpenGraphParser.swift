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
    string
        .replacingOccurrences(of: "&quot;", with: "\"", options: .caseInsensitive)
        .replacingOccurrences(of: "&#39;", with: "'")
        .replacingOccurrences(of: "&gt;", with: ">", options: .caseInsensitive)
        .replacingOccurrences(of: "&lt;", with: "<", options: .caseInsensitive)
        .replacingOccurrences(of: "&amp;", with: "&", options: .caseInsensitive)
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

private func parseDocumentTitle(_ html: String) -> String? {
    let patterns = [
        #"<title[^>]*>([\s\S]*?)</title>"#,
        #"<title[^>]*>([\s\S]*?)</title[^>]*>"#,
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

private func toAbsoluteHref(resolvedPageURL: String, raw: String) -> String? {
    guard let normalized = normalizeMetaValue(decodeMinimalEntities(stripWhitespace(raw))) else {
        return nil
    }
    if let url = URL(string: normalized, relativeTo: URL(string: resolvedPageURL)) {
        return url.absoluteString
    }
    return nil
}

public func parseOpenGraphMarkup(html: String, resolvedPageURL: String) -> OpenGraphFields {
    let slice = sliceForMarkup(html)

    let title = metaTagContent(scope: slice, kind: "property", key: "og:title")
        ?? metaTagContent(scope: slice, kind: "name", key: "twitter:title")
        ?? parseDocumentTitle(slice)

    let description = metaTagContent(scope: slice, kind: "property", key: "og:description")
        ?? metaTagContent(scope: slice, kind: "name", key: "twitter:description")
        ?? metaTagContent(scope: slice, kind: "name", key: "description")

    let siteName = metaTagContent(scope: slice, kind: "property", key: "og:site_name")

    let author = metaTagContent(scope: slice, kind: "property", key: "article:author")
        ?? metaTagContent(scope: slice, kind: "name", key: "author")

    let imageRaw = metaTagContent(scope: slice, kind: "property", key: "og:image")
        ?? metaTagContent(scope: slice, kind: "name", key: "twitter:image")
    let image = imageRaw.flatMap { toAbsoluteHref(resolvedPageURL: resolvedPageURL, raw: $0) ?? $0 }

    return OpenGraphFields(
        title: title,
        description: description,
        image: image,
        siteName: siteName,
        author: author
    )
}

public func openGraphMetadata(from fields: OpenGraphFields) -> OpenGraphMetadata {
    OpenGraphMetadata(
        title: fields.title,
        description: fields.description,
        image: fields.image,
        siteName: fields.siteName,
        author: fields.author
    )
}
