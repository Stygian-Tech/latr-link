import Foundation

public struct AtUriParts: Sendable, Equatable {
    public let repo: String
    public let collection: String
    public let rkey: String

    public init(repo: String, collection: String, rkey: String) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
    }
}

public func parseAtUri(_ uri: String) -> AtUriParts? {
    let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("at://") else { return nil }

    let withoutScheme = String(trimmed.dropFirst("at://".count))
    let segments = withoutScheme.split(separator: "/", omittingEmptySubsequences: false)
    guard segments.count >= 3 else { return nil }

    let repo = String(segments[0])
    let collection = String(segments[1])
    let rkey = segments.dropFirst(2).joined(separator: "/")
    guard !repo.isEmpty, !collection.isEmpty, !rkey.isEmpty else { return nil }

    return AtUriParts(repo: repo, collection: collection, rkey: rkey)
}

public func xrpcURL(base: String, method: String, query: [String: String] = [:]) -> URL? {
    var normalized = base.trimmingCharacters(in: .whitespacesAndNewlines)
    while normalized.hasSuffix("/") {
        normalized.removeLast()
    }
    guard !normalized.isEmpty else { return nil }

    var components = URLComponents(string: "\(normalized)/xrpc/\(method)")!
    if !query.isEmpty {
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    }
    return components.url
}

public func xrpcURL(base: String, method: String, indexedQuery: [(String, String)]) -> URL? {
    var normalized = base.trimmingCharacters(in: .whitespacesAndNewlines)
    while normalized.hasSuffix("/") {
        normalized.removeLast()
    }
    guard !normalized.isEmpty else { return nil }

    var components = URLComponents(string: "\(normalized)/xrpc/\(method)")!
    components.queryItems = indexedQuery.map { URLQueryItem(name: $0.0, value: $0.1) }
    return components.url
}
