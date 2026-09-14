import Foundation

public struct LoginHandleSuggestion: Decodable, Identifiable, Equatable, Sendable {
    public let did: String
    public let handle: String
    public let displayName: String?
    public let avatar: String?
    public var id: String { did }
}

/// Public account discovery only: no session, OAuth headers, or gateway credentials.
public struct LoginHandleTypeahead: Sendable {
    public static let serviceURL = URL(string: "https://typeahead.waow.tech")!
    private let http: any NativeHTTPClient

    public init() { http = SystemHTTPClient() }
    init(http: any NativeHTTPClient) { self.http = http }

    public static func query(for input: String) -> String? {
        let whitespace = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))
        var value = input.trimmingCharacters(in: whitespace)
        if value.hasPrefix("@") { value.removeFirst() }
        guard value.utf16.count >= 2, !value.contains(":"), !value.contains("/"),
              value.rangeOfCharacter(from: whitespace) == nil else { return nil }
        return value
    }

    public func search(_ input: String) async throws -> [LoginHandleSuggestion] {
        try Task.checkCancellation()
        guard let query = Self.query(for: input) else { return [] }
        var url = URLComponents(url: Self.serviceURL.appending(path: "xrpc/app.bsky.actor.searchActorsTypeahead"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "limit", value: "6")]
        let response = try await http.send(URLRequest(url: url.url!))
        // Some injected or cached transports may finish after cancellation.
        try Task.checkCancellation()
        struct Results: Decodable { let actors: [LoginHandleSuggestion]? }
        return try JSONDecoder().decode(Results.self, from: response.checked()).actors ?? []
    }
}

#if DEBUG
public extension LoginHandleTypeahead {
    /// Explicit UI-test fixture. Production builds contain no fixture transport.
    static func preview() -> LoginHandleTypeahead { LoginHandleTypeahead(http: PreviewTypeaheadHTTP()) }
}

private struct PreviewTypeaheadHTTP: NativeHTTPClient {
    func send(_ request: URLRequest) async throws -> HTTPResult {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value ?? ""
        let actors: [[String: String]] = query.hasPrefix("ali")
            ? [["did": "did:plc:typeaheadalice", "handle": "alice.example", "displayName": "Alice Example"]]
            : []
        return HTTPResult(data: try JSONSerialization.data(withJSONObject: ["actors": actors]), response: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
#endif
