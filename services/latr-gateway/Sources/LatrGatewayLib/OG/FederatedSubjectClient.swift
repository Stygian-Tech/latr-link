import AsyncHTTPClient
import Foundation
import LatrKit

public struct FederatedSubjectClientConfig: Sendable {
    public let plcURL: String
    /// AppView bases used after DID-document discovery (deduped fallbacks).
    public let appViewBaseURLs: [String]
    /// Identity relay used before PDS/identity endpoints from DID documents.
    public let identityBaseURL: String

    public init(
        plcURL: String,
        appViewBaseURLs: [String] = [FederatedSubjectClient.defaultAppViewBaseURL],
        identityBaseURL: String = FederatedSubjectClient.defaultIdentityBaseURL
    ) {
        self.plcURL = plcURL
        self.appViewBaseURLs = appViewBaseURLs
        self.identityBaseURL = identityBaseURL
    }
}

/// PDS-first public record reads with DID-document AppView discovery and env fallbacks.
public struct FederatedSubjectClient: AppViewFeedClient, UntypedRecordClient, Sendable {
    public static let defaultAppViewBaseURL = "https://public.api.bsky.app"
    public static let defaultIdentityBaseURL = "https://bsky.social"

    private let httpClient: HTTPClient
    private let config: FederatedSubjectClientConfig
    private let didDocCache: LockStorage<[String: [String: Any]]> = .init([:])
    private let pdsCache: LockStorage<[String: String]> = .init([:])
    private let appViewCache: LockStorage<[String: [String]]> = .init([:])

    public init(httpClient: HTTPClient, config: FederatedSubjectClientConfig) {
        self.httpClient = httpClient
        self.config = config
    }

    public func postPreview(for subjectURI: String) async -> AppViewPostPreview? {
        let candidates = await appViewCandidates(for: subjectURI)
        for base in candidates {
            if let preview = await fetchPostPreview(fromAppView: base, subjectURI: subjectURI) {
                return preview
            }
        }
        return await postPreviewFromPDS(subjectURI: subjectURI)
    }

    public func resolveActorDID(_ actor: String) async -> String? {
        let trimmed = actor.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("did:") { return trimmed }

        if let did = await resolveHandle(trimmed, baseURL: config.identityBaseURL) {
            return did
        }

        for base in await appViewCandidates(forRepoDID: nil) {
            if let did = await resolveHandleViaProfile(actor: trimmed, appViewBase: base) {
                return did
            }
        }

        return nil
    }

    public func recordValue(in repository: String, collection: String, withKey key: String) async -> [String: Any]? {
        guard let pdsBase = await resolvePDSBase(for: repository) else { return nil }
        guard let url = xrpcURL(
            base: pdsBase,
            method: "com.atproto.repo.getRecord",
            query: ["repo": repository, "collection": collection, "rkey": key]
        ) else {
            return nil
        }

        guard let json = try? await getJSON(url: url),
              let value = json["value"] as? [String: Any]
        else {
            return nil
        }
        return value
    }

    private func appViewCandidates(for subjectURI: String) async -> [String] {
        let repoDID = parseAtUri(subjectURI)?.repo
        return await appViewCandidates(forRepoDID: repoDID)
    }

    private func appViewCandidates(forRepoDID repoDID: String?) async -> [String] {
        let discovered: [String]
        if let repoDID {
            discovered = await appViewBasesFromDIDDocument(repoDID: repoDID)
        } else {
            discovered = []
        }

        return mergeServiceBases(
            [discovered, config.appViewBaseURLs],
            fallback: [Self.defaultAppViewBaseURL]
        )
    }

    private func appViewBasesFromDIDDocument(repoDID: String) async -> [String] {
        if let cached = appViewCache.value[repoDID] {
            return cached
        }

        guard let didDoc = await fetchDIDDocument(for: repoDID) else {
            appViewCache.value[repoDID] = []
            return []
        }

        let discovered = parseAppViewEndpointsFromDIDDoc(didDoc)
        appViewCache.value[repoDID] = discovered
        return discovered
    }

    private func resolvePDSBase(for repoDID: String) async -> String? {
        if let cached = pdsCache.value[repoDID] {
            return cached
        }

        guard let didDoc = await fetchDIDDocument(for: repoDID),
              let pdsBase = parsePDSEndpointFromDIDDoc(didDoc)
        else {
            return nil
        }

        pdsCache.value[repoDID] = pdsBase
        return pdsBase
    }

    private func fetchDIDDocument(for repoDID: String) async -> [String: Any]? {
        if let cached = didDocCache.value[repoDID] {
            return cached
        }

        guard let url = didDocumentURL(for: repoDID, plcURL: config.plcURL) else {
            return nil
        }

        guard let json = try? await getJSON(url: url) else {
            return nil
        }

        didDocCache.value[repoDID] = json
        return json
    }

    private func resolveHandle(_ handle: String, baseURL: String) async -> String? {
        guard let url = xrpcURL(
            base: baseURL,
            method: "com.atproto.identity.resolveHandle",
            query: ["handle": handle]
        ) else {
            return nil
        }

        guard let json = try? await getJSON(url: url) else { return nil }
        return json["did"] as? String
    }

    private func resolveHandleViaProfile(actor: String, appViewBase: String) async -> String? {
        guard let url = xrpcURL(
            base: appViewBase,
            method: "app.bsky.actor.getProfile",
            query: ["actor": actor]
        ) else {
            return nil
        }

        guard let json = try? await getJSON(url: url) else { return nil }
        return json["did"] as? String
    }

    private func fetchPostPreview(fromAppView base: String, subjectURI: String) async -> AppViewPostPreview? {
        guard let url = xrpcURL(
            base: base,
            method: "app.bsky.feed.getPosts",
            indexedQuery: [("uris[0]", subjectURI)]
        ) else {
            return nil
        }

        guard let json = try? await getJSON(url: url),
              let posts = json["posts"] as? [[String: Any]],
              let first = posts.first
        else {
            return nil
        }

        return parseAppViewPostPreview(first)
    }

    private func postPreviewFromPDS(subjectURI: String) async -> AppViewPostPreview? {
        guard let parts = parseAtUri(subjectURI),
              parts.collection == "app.bsky.feed.post",
              let value = await recordValue(
                  in: parts.repo,
                  collection: parts.collection,
                  withKey: parts.rkey
              )
        else {
            return nil
        }

        let text = value["text"] as? String
        if text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            return nil
        }
        return AppViewPostPreview(text: text)
    }

    private func parseAppViewPostPreview(_ post: [String: Any]) -> AppViewPostPreview? {
        let record = post["record"] as? [String: Any]
        let author = post["author"] as? [String: Any]
        let text = record?["text"] as? String
        let handle = author?["handle"] as? String

        var thumbURL: String?
        if let embed = post["embed"] as? [String: Any] {
            if let images = embed["images"] as? [[String: Any]],
               let first = images.first,
               let fullsize = first["fullsize"] as? String
            {
                thumbURL = fullsize
            } else if let thumb = embed["thumb"] as? String {
                thumbURL = thumb
            }
        }

        if text == nil, handle == nil, thumbURL == nil { return nil }
        return AppViewPostPreview(text: text, authorHandle: handle, embedThumbURL: thumbURL)
    }

    private func getJSON(url: URL) async throws -> [String: Any] {
        var request = HTTPClientRequest(url: url.absoluteString)
        request.headers.add(name: "Accept", value: "application/json")
        let response = try await httpClient.execute(request, timeout: .seconds(15))
        guard (200 ... 299).contains(response.status.code) else {
            throw URLError(.badServerResponse)
        }
        let body = try await response.body.collect(upTo: 2_097_152)
        guard body.readableBytes > 0 else { return [:] }
        return (try JSONSerialization.jsonObject(with: Data(buffer: body)) as? [String: Any]) ?? [:]
    }
}

private final class LockStorage<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T

    init(_ value: T) {
        self.stored = value
    }

    var value: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            stored = newValue
            lock.unlock()
        }
    }
}

/// Backward-compatible alias while callers migrate.
public typealias BlueskyAppViewClient = FederatedSubjectClient

public enum BlueskyAppView {
    public static let publicBaseURL = FederatedSubjectClient.defaultAppViewBaseURL
}
