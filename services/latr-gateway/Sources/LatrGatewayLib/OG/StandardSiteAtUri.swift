import Foundation

public func tryCanonicalAtURI(_ trimmedInput: String) -> String? {
    let trimmed = trimmedInput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("at://") else { return nil }

    let withoutScheme = String(trimmed.dropFirst("at://".count))
    let parts = withoutScheme.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count >= 3 else { return nil }

    let hostname = String(parts[0])
    let collection = String(parts[1])
    let rkey = parts.dropFirst(2).joined(separator: "/")

    guard !hostname.isEmpty, !collection.isEmpty, !rkey.isEmpty else { return nil }
    return "at://\(hostname)/\(collection)/\(rkey)"
}

private func decodeMinimalHref(_ string: String) -> String {
    string
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "&quot;", with: "\"", options: .caseInsensitive)
        .replacingOccurrences(of: "&#39;", with: "'")
        .replacingOccurrences(of: "&amp;", with: "&", options: .caseInsensitive)
}

private func sliceForEarlyHeadMarkup(_ html: String) -> String {
    let lower = html.lowercased()
    if let range = lower.range(of: "</head>") {
        return String(html[..<range.upperBound])
    }
    return html.count > 300_000 ? String(html.prefix(300_000)) : html
}

public func extractSiteStandardDocumentAtURI(_ html: String) -> String? {
    let scope = sliceForEarlyHeadMarkup(html)

    let relFirstPattern =
        #"<link\b[^>]*?\brel\s*=\s*["']site\.standard\.document["'][^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>"#
    let hrefFirstPattern =
        #"<link\b[^>]*?\bhref\s*=\s*["'](at://[^"']+)["'][^>]*?\brel\s*=\s*["']site\.standard\.document["'][^>]*>"#

    let patterns = [hrefFirstPattern, relFirstPattern]
    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(scope.startIndex..., in: scope)
        if let match = regex.firstMatch(in: scope, range: range),
           let capture = Range(match.range(at: 1), in: scope)
        {
            let cleaned = decodeMinimalHref(String(scope[capture]))
            if let canonical = tryCanonicalAtURI(cleaned) {
                return canonical
            }
        }
    }
    return nil
}
