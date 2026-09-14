#if DEBUG
import Foundation
import CryptoKit
import LatrKit

/// Explicit UI-test/preview injection. It never makes network requests and is absent in Release.
public extension NativeRuntime {
    static func preview(directory: URL, authenticated: Bool = true) throws -> NativeRuntime {
        let configuration = NativeConfiguration(environment: .testing, appGroupIdentifier: "preview", keychainAccessGroup: "preview")
        let store = try NativeStore(directory: directory)
        let vault = MemorySessionVault(session: authenticated ? previewSession() : nil)
        let http = PreviewHTTPClient()
        let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
        let library = NativeLibrary(configuration: configuration, oauth: oauth, store: store, http: http, directory: directory)
        return NativeRuntime(configuration: configuration, oauth: oauth, library: library, store: store)
    }
    internal static func previewSession(did: String = "did:plc:nativepreview", expired: Bool = false) -> NativeSession {
        NativeSession(did: did, handle: "reader.example.com", environment: .testing, pdsURL: URL(string: "https://pds.example.com")!,
            issuer: URL(string: "https://pds.example.com")!, tokenEndpoint: URL(string: "https://pds.example.com/oauth/token")!,
            accessToken: "preview-access", refreshToken: "preview-refresh", scope: NativeConfiguration.scopes,
            expiresAt: Date().addingTimeInterval(expired ? -60 : 3600), privateKey: P256.Signing.PrivateKey().rawRepresentation, nonces: [:], generation: UUID())
    }
}
actor MemorySessionVault: SessionVault {
    var session: NativeSession?
    var authorization: Data?
    init(session: NativeSession? = nil) { self.session = session }
    func load() -> NativeSession? { session }
    func save(_ session: NativeSession) { self.session = session }
    func clear() { session = nil; authorization = nil }
    func savePendingAuthorization(_ data: Data?) { authorization = data }
    func pendingAuthorization() -> Data? { authorization }
}
private actor PreviewHTTPClient: NativeHTTPClient {
    var rows: [BookmarkView] = [
        BookmarkView(record: RepositoryRecord(uri: "at://did:plc:nativepreview/community.lexicon.bookmarks.bookmark/one", cid: "preview-one", value: CommunityBookmark(subject: "https://developer.apple.com/swiftui/", createdAt: "2026-09-14T00:00:00Z", tags: ["Development", "Read later"])), preview: OpenGraphPreview(title: "Build with SwiftUI", description: "A native way to build great apps across Apple platforms.", siteName: "Apple Developer")),
        BookmarkView(record: RepositoryRecord(uri: "at://did:plc:nativepreview/community.lexicon.bookmarks.bookmark/two", cid: "preview-two", value: CommunityBookmark(subject: "https://atproto.com/", createdAt: "2026-09-13T00:00:00Z", tags: ["Open web"])), preview: OpenGraphPreview(title: "A social internet built on open protocols", description: "Explore portable identity and the shared social web.", siteName: "AT Protocol"))
    ]
    func send(_ request: URLRequest) throws -> HTTPResult {
        guard let url = request.url else { throw NativeError.invalidResponse }
        let method = url.lastPathComponent
        var object: Any
        var status = 200
        if url.host == "pds.example.com" {
            status = request.httpMethod == "POST" ? 400 : 200
            object = status == 400 ? ["error": "InvalidRequest"] : ["records": []]
        } else if method == "link.latr.bookmarks.listBookmarks" {
            let tag = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "tag" })?.value
            let filtered = rows.filter { row in tag == nil || row.tags.contains(where: { Data($0.utf8) == Data(tag!.utf8) }) }
            object = ["bookmarks": try JSONSerialization.jsonObject(with: JSONEncoder().encode(filtered))]
        } else if method == "link.latr.bookmarks.listTags" {
            var counts: [String: Int] = [:]
            for row in rows { for tag in row.tags { counts[tag, default: 0] += 1 } }
            object = ["tagCounts": counts.keys.sorted().map { ["tag": $0, "count": counts[$0]!] as [String: Any] }, "scanned": rows.count]
        } else if method == "link.latr.bookmarks.saveBookmark", let body = request.httpBody,
                  let input = try? JSONDecoder().decode(LatrSaveBookmarkInput.self, from: body) {
            let row = BookmarkView(record: RepositoryRecord(uri: "at://did:plc:nativepreview/community.lexicon.bookmarks.bookmark/\(UUID().uuidString)", cid: "preview", value: CommunityBookmark(subject: input.subject, createdAt: ISO8601DateFormatter().string(from: Date()), tags: input.tags)))
            rows.insert(row, at: 0); object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(row))
        } else if method == "link.latr.bookmarks.migrateLegacy" {
            object = ["ok": true, "scanned": 0, "created": 0, "reused": 0, "duplicates": 0, "skippedConflict": 0, "cached": 0, "retired": 0]
        } else if method == "link.latr.bookmarks.syncMetadata" {
            object = ["ok": true, "scanned": 0, "created": 0, "reused": 0, "skippedConflict": 0]
        } else if url.host == "userinput.app" {
            object = ["board": ["uri": "at://did:plc:qy5pluw2bsuq2x6albsgkvx3/app.userinput.space/3msgeiqdplp2m", "cid": "preview", "value": ["tags": [["label": "Bug", "value": "bug"], ["label": "Feature", "value": "feature"]]]]]
        } else { throw NativeError.configuration("This preview does not simulate that operation.") }
        return HTTPResult(data: try JSONSerialization.data(withJSONObject: object), response: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["DPoP-Nonce": UUID().uuidString])!)
    }
}
#endif
