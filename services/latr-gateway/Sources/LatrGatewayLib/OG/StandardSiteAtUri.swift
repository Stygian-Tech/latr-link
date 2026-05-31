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
    HtmlTextDecoder.decode(string.trimmingCharacters(in: .whitespacesAndNewlines))
}

func sliceForEarlyHeadMarkup(_ html: String) -> String {
    let lower = html.lowercased()
    if let range = lower.range(of: "</head>") {
        return String(html[..<range.upperBound])
    }
    return html.count > 300_000 ? String(html.prefix(300_000)) : html
}

private func collectionFromAtURI(_ uri: String) -> String? {
    guard uri.hasPrefix("at://") else { return nil }
    let withoutScheme = String(uri.dropFirst("at://".count))
    let parts = withoutScheme.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count >= 2 else { return nil }
    return String(parts[1])
}

private func isWrapperExternalURI(_ uri: String) -> Bool {
    collectionFromAtURI(uri) == "com.latr.saved.external"
}

private struct HeadAtURICandidate {
    let index: Int
    let uri: String
}

private func linkHrefCandidates(in scope: String) -> [HeadAtURICandidate] {
    let pattern = #"<link\b[^>]*?\bhref\s*=\s*["'](at://[^"']+)["'][^>]*>"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return []
    }

    let range = NSRange(scope.startIndex..., in: scope)
    return regex.matches(in: scope, range: range).compactMap { match in
        guard let capture = Range(match.range(at: 1), in: scope) else { return nil }
        let cleaned = decodeMinimalHref(String(scope[capture]))
        guard let canonical = tryCanonicalAtURI(cleaned) else { return nil }
        return HeadAtURICandidate(index: match.range.location, uri: canonical)
    }
}

private func metaContentCandidates(in scope: String) -> [HeadAtURICandidate] {
    let pattern = #"<meta\b[^>]*?\bcontent\s*=\s*["'](at://[^"']+)["'][^>]*>"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return []
    }

    let range = NSRange(scope.startIndex..., in: scope)
    return regex.matches(in: scope, range: range).compactMap { match in
        guard let capture = Range(match.range(at: 1), in: scope) else { return nil }
        let cleaned = decodeMinimalHref(String(scope[capture]))
        guard let canonical = tryCanonicalAtURI(cleaned) else { return nil }
        return HeadAtURICandidate(index: match.range.location, uri: canonical)
    }
}

/// Scans early `<head>` markup for the first canonical native `at://` URI.
public func extractAtUriFromHead(_ html: String) -> String? {
    let scope = sliceForEarlyHeadMarkup(html)
    let candidates = (linkHrefCandidates(in: scope) + metaContentCandidates(in: scope))
        .sorted { $0.index < $1.index }

    if let preferred = candidates.first(where: { !isWrapperExternalURI($0.uri) }) {
        return preferred.uri
    }
    return candidates.first?.uri
}

public func extractSiteStandardDocumentAtURI(_ html: String) -> String? {
    extractAtUriFromHead(html)
}
