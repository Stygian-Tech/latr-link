import Foundation

public func hostnameLabel(from urlString: String) -> String? {
    guard let host = URL(string: urlString)?.host?.lowercased() else { return nil }
    if host.hasPrefix("www.") {
        return String(host.dropFirst(4))
    }
    return host
}

public func humanizeURLSlug(_ slug: String) -> String {
    let decoded = slug.removingPercentEncoding ?? slug
    let words = decoded
        .replacingOccurrences(of: "_", with: "-")
        .split(separator: "-")
        .map { word in
            word.prefix(1).uppercased() + word.dropFirst()
        }
    let joined = words.joined(separator: " ")
    return joined.isEmpty ? decoded : joined
}

public func degradedOpenGraphFields(from urlString: String) -> OpenGraphFields {
    guard let url = URL(string: urlString) else { return OpenGraphFields() }
    let siteName = hostnameLabel(from: urlString)
    let pathParts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
    let title = pathParts.last.map(humanizeURLSlug) ?? siteName
    return OpenGraphFields(title: title, siteName: siteName)
}

public func enrichOpenGraphFields(_ fields: OpenGraphFields, resolvedPageURL: String) -> OpenGraphFields {
    var enriched = fields
    guard let host = hostnameLabel(from: resolvedPageURL) else { return enriched }

    if enriched.siteName == nil {
        enriched.siteName = host
    }
    if enriched.title == nil, let siteName = enriched.siteName {
        enriched.title = siteName
    }
    return enriched
}

public extension OpenGraphFields {
    var hasAnyValue: Bool {
        title != nil
            || description != nil
            || image != nil
            || siteName != nil
            || author != nil
    }
}
