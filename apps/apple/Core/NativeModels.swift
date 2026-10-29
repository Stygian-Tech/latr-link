import Foundation
@_exported import LatrKit

public enum NativeEnvironment: String, Codable, CaseIterable, Sendable { case testing, production }

public struct NativeConfiguration: Sendable {
    public let environment: NativeEnvironment
    public let appGroupIdentifier: String
    public let keychainAccessGroup: String
    public var webBaseURL: URL { URL(string: environment == .production ? "https://latr.link" : "https://testing.latr.link")! }
    public var gatewayURL: URL { webBaseURL.appending(path: "api/latr-gateway") }
    public var clientID: URL { webBaseURL.appending(path: environment == .production ? "oauth/ios-client-metadata.json" : "oauth/ios-testing-client-metadata.json") }
    public var callbackScheme: String { environment == .production ? "link.latr" : "link.latr.testing" }
    public var redirectURI: URL { URL(string: "\(callbackScheme):/oauth/ios")! }
    public static let scopes = "atproto repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete include:link.latr.authFull repo:link.latr.saved.external?action=delete repo:link.latr.saved.item?action=delete repo:com.latr.saved.external?action=delete repo:com.latr.saved.item?action=delete include:app.userinput.authFull blob:*/*"

    public init(environment: NativeEnvironment, appGroupIdentifier: String, keychainAccessGroup: String) {
        self.environment = environment; self.appGroupIdentifier = appGroupIdentifier; self.keychainAccessGroup = keychainAccessGroup
    }
}

public enum NativeError: Error, LocalizedError, Sendable, Equatable {
    case notAuthenticated, invalidSubject, invalidCallback, invalidIdentity, sessionExpired, busy, storage(String), invalidResponse, http(Int, String), configuration(String)
    public var errorDescription: String? {
        switch self {
        case .notAuthenticated: "Open L@tr.link and sign in before saving."
        case .invalidSubject: "Choose a valid web link or AT Protocol record."
        case .invalidCallback: "The sign-in response could not be verified. Please try again."
        case .invalidIdentity: "The account identity could not be verified."
        case .sessionExpired: "Sign in again to continue. Your pending saves are retained."
        case .busy: "Another L@tr.link operation is running. Your save can be retried."
        case .storage(let message), .configuration(let message): message
        case .invalidResponse: "The server returned an invalid response."
        case .http(let status, let message): "\(message) (\(status))"
        }
    }
    public var requiresAuthentication: Bool { self == .notAuthenticated || self == .sessionExpired }
}

public struct NativeSession: Codable, Sendable, Equatable {
    public let did: String
    public let handle: String?
    public let environment: NativeEnvironment
    public let pdsURL: URL
    let issuer: URL
    let tokenEndpoint: URL
    let accessToken: String
    let refreshToken: String
    let scope: String
    let expiresAt: Date
    let privateKey: Data
    var nonces: [String: String]
    let generation: UUID
}

public struct PendingSave: Codable, Sendable, Identifiable, Equatable {
    public let id: UUID
    public var subject: String
    public var tags: [String]
    public var did: String?
    public let environment: NativeEnvironment
    public let createdAt: Date
    public var lastError: String?
    public var isDraft: Bool { did == nil }
    public init(id: UUID = UUID(), subject: String, tags: [String], did: String?, environment: NativeEnvironment, createdAt: Date = Date(), lastError: String? = nil) {
        self.id = id; self.subject = subject; self.tags = tags; self.did = did; self.environment = environment; self.createdAt = createdAt; self.lastError = lastError
    }
}

public struct BookmarkPage: Sendable {
    public let bookmarks: [BookmarkView]
    public let cursor: String?
}

public enum SharedLinkParser {
    public static func validatedSubject(_ text: String) throws -> String {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf8.count <= 8192 else { throw NativeError.invalidSubject }
        if value.hasPrefix("at://") {
            let path = value.dropFirst(5).split(separator: "/", omittingEmptySubsequences: false)
            guard path.count == 3, path.allSatisfy({ !$0.isEmpty }), !value.contains(where: { $0.isWhitespace }), !value.contains("?"), !value.contains("#") else { throw NativeError.invalidSubject }
        } else {
            guard let parts = URLComponents(string: value), parts.user == nil, parts.password == nil else { throw NativeError.invalidSubject }
            guard ["http", "https"].contains(parts.scheme?.lowercased() ?? ""), let host = parts.host, !host.isEmpty,
                  !value.contains(where: { $0.isWhitespace || $0.isNewline }) else { throw NativeError.invalidSubject }
        }
        return value
    }
    public static func subjects(in text: String) -> [String] {
        if let direct = try? validatedSubject(text) { return [direct] }
        let pattern = #"(?:https?://|at://)[^\s<>\"]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return [] }
        var seen = Set<String>()
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard let range = Range(match.range, in: text) else { return nil }
            let candidate = String(text[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;!?)]}"))
            guard let value = try? validatedSubject(candidate), seen.insert(value).inserted else { return nil }
            return value
        }
    }
}

public enum TagValidation {
    public static func normalize(_ tags: [String]) throws -> [String] {
        var seen = Set<Data>()
        let normalized = try tags.map(normalize).filter { seen.insert(Data($0.utf8)).inserted }
        guard normalized.count <= 100 else { throw NativeError.storage("Use at most 100 tags.") }
        return normalized
    }
    public static func normalize(_ tag: String) throws -> String { try LatrPayloadValidator.validateTag(tag) }
}

public extension BookmarkView {
    var subject: String { value.subject }
    var title: String { preview?.title ?? value.subject }
    var tags: [String] { value.tags ?? [] }
    var isArchived: Bool { metadataRecord?.value.state == .archived }
}
