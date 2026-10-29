import Foundation
import LatrKit

public struct NativeRuntime: Sendable {
    public let configuration: NativeConfiguration
    public let oauth: OAuthClient
    public let library: NativeLibrary
    public let store: NativeStore
    init(configuration: NativeConfiguration, oauth: OAuthClient, library: NativeLibrary, store: NativeStore) {
        self.configuration = configuration; self.oauth = oauth; self.library = library; self.store = store
    }
    public init(configuration: NativeConfiguration) throws {
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: configuration.appGroupIdentifier) else {
            throw NativeError.configuration("The shared app container is unavailable. Enable the L@tr.link App Group for both the app and Share extension.")
        }
        let store = try NativeStore(directory: directory)
        let http = SystemHTTPClient()
        let oauth = OAuthClient(configuration: configuration, vault: KeychainSessionVault(configuration: configuration), http: http, directory: directory)
        self.configuration = configuration; self.oauth = oauth; self.store = store
        library = NativeLibrary(configuration: configuration, oauth: oauth, store: store, http: http, directory: directory)
    }
}

public actor NativeLibrary {
    public let configuration: NativeConfiguration
    public let oauth: OAuthClient
    public let store: NativeStore
    let http: any NativeHTTPClient
    private let queueLock: ProcessLock
    init(configuration: NativeConfiguration, oauth: OAuthClient, store: NativeStore, http: any NativeHTTPClient, directory: URL) {
        self.configuration = configuration; self.oauth = oauth; self.store = store; self.http = http
        queueLock = ProcessLock(file: directory.appending(path: "queue.lock"))
    }
    private func accountKey(_ suffix: String) async throws -> String {
        cacheKey(suffix, did: try await accountDID())
    }
    private func accountDID() async throws -> String {
        guard let session = try await oauth.restoreSession() else { throw NativeError.notAuthenticated }
        return session.did
    }
    private func cacheKey(_ suffix: String, did: String) -> String { "\(configuration.environment.rawValue):\(did):\(suffix)" }
    private func client(for did: String) -> LatrXRPCClient {
        LatrXRPCClient(transport: NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http, expectedDID: did))
    }
    public func bookmarkPage(tag: String? = nil, cursor: String? = nil, limit: Int = 50) async throws -> BookmarkPage {
        try await bookmarkPage(tag: tag, cursor: cursor, limit: limit, did: accountDID())
    }
    private func bookmarkPage(tag: String?, cursor: String?, limit: Int, did: String) async throws -> BookmarkPage {
        let key = cacheKey("bookmarks", did: did), client = client(for: did)
        // Metadata repair is best-effort and bounded; a failure must not hide saved bookmarks.
        _ = try? await client.syncBookmarkMetadata(.init(limit: 25, cursor: cursor))
        let page = try await client.listBookmarks(.init(limit: limit, cursor: cursor, tag: tag))
        var cached = try await store.value([BookmarkView].self, for: key) ?? []
        let replaced = Set(page.bookmarks.map(\.uri))
        cached.removeAll { replaced.contains($0.uri) }
        cached.append(contentsOf: page.bookmarks)
        try await store.set(cached, for: key)
        return BookmarkPage(bookmarks: page.bookmarks, cursor: page.cursor)
    }
    public func listBookmarks(tag: String? = nil) async throws -> [BookmarkView] {
        try await listBookmarks(tag: tag, did: accountDID())
    }
    private func listBookmarks(tag: String?, did: String) async throws -> [BookmarkView] {
        var rows: [BookmarkView] = []; var cursor: String?; var seen = Set<String>()
        repeat {
            try Task.checkCancellation()
            let page = try await bookmarkPage(tag: tag, cursor: cursor, limit: 50, did: did)
            rows.append(contentsOf: page.bookmarks); cursor = page.cursor
            if let cursor, !seen.insert(cursor).inserted { throw NativeError.invalidResponse }
        } while cursor != nil
        if tag == nil { try await store.set(rows, for: cacheKey("bookmarks", did: did)) }
        return rows
    }
    public func cachedBookmarks() async throws -> [BookmarkView] { try await store.value([BookmarkView].self, for: accountKey("bookmarks")) ?? [] }
    public func clearCache() async throws { try await store.remove(accountKey("bookmarks")) }
    public func listTags() async throws -> [LatrTagCount] {
        try await listTags(did: accountDID())
    }
    private func listTags(did: String) async throws -> [LatrTagCount] {
        let client = client(for: did)
        var counts: [Data: (String, Int)] = [:]; var cursor: String?; var seen = Set<String>()
        repeat {
            let page = try await client.listTags(.init(limit: 100, cursor: cursor))
            for count in page.tagCounts {
                let bytes = Data(count.tag.utf8)
                counts[bytes] = (count.tag, (counts[bytes]?.1 ?? 0) + count.count)
            }
            cursor = page.cursor
            if let cursor, !seen.insert(cursor).inserted { throw NativeError.invalidResponse }
        } while cursor != nil
        return counts.values.map { LatrTagCount(tag: $0.0, count: $0.1) }.sorted { $0.tag.utf8.lexicographicallyPrecedes($1.tag.utf8) }
    }
    public func save(subject: String, tags: [String] = []) async throws {
        try await save(subject: subject, tags: tags, expectedDID: nil)
    }
    private func save(subject: String, tags: [String], expectedDID: String?) async throws {
        let did = try await accountDID()
        guard expectedDID == nil || expectedDID == did else { throw NativeError.invalidIdentity }
        let subject = try SharedLinkParser.validatedSubject(subject)
        let transport = NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http, expectedDID: did)
        let input = LatrSaveBookmarkInput(subject: subject, tags: try TagValidation.normalize(tags))
        let row = try await JSONDecoder().decode(BookmarkView.self, from: transport.send(method: .saveBookmark, parameters: [], body: JSONEncoder().encode(input)))
        try await cache(row, did: did)
    }
    public func setState(bookmarkURI: String, archived: Bool) async throws {
        let did = try await accountDID(), client = client(for: did)
        try Self.validateOwner(bookmarkURI, did: did)
        _ = try await client.setBookmarkState(.init(bookmarkUri: bookmarkURI, state: archived ? .archived : .unread))
        try await refreshCachedBookmark(uri: bookmarkURI, did: did)
    }
    public func setTags(bookmarkURI: String, tags: [String]) async throws {
        let did = try await accountDID()
        try Self.validateOwner(bookmarkURI, did: did)
        try LatrPayloadValidator.validateATURI(bookmarkURI)
        let input = LatrSetBookmarkTagsInput(bookmarkUri: bookmarkURI, tags: try TagValidation.normalize(tags))
        let transport = NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http, expectedDID: did)
        let row = try await JSONDecoder().decode(BookmarkView.self, from: transport.send(method: .setBookmarkTags, parameters: [], body: JSONEncoder().encode(input)))
        try await cache(row, did: did)
    }
    public func deleteBookmark(uri: String) async throws {
        let did = try await accountDID(), client = client(for: did)
        try Self.validateOwner(uri, did: did)
        _ = try await client.deleteBookmark(.init(bookmarkUri: uri))
        let key = cacheKey("bookmarks", did: did)
        var rows = try await store.value([BookmarkView].self, for: key) ?? []; rows.removeAll { $0.uri == uri }; try await store.set(rows, for: key)
    }
    private func cache(_ row: BookmarkView, did: String) async throws {
        let key = cacheKey("bookmarks", did: did)
        var rows = try await store.value([BookmarkView].self, for: key) ?? []; rows.removeAll { $0.uri == row.uri }; rows.insert(row, at: 0)
        try await store.set(rows, for: key)
    }
    private func refreshCachedBookmark(uri: String, did: String) async throws {
        guard let row = try await store.value([BookmarkView].self, for: cacheKey("bookmarks", did: did))?.first(where: { $0.uri == uri }) else { return }
        if let refreshed = try await client(for: did).getBookmark(subject: row.subject).bookmark { try await cache(refreshed, did: did) }
    }
    private static func validateOwner(_ uri: String, did: String) throws {
        guard uri.hasPrefix("at://\(did)/community.lexicon.bookmarks.bookmark/") else { throw NativeError.invalidIdentity }
    }
    public func renameTag(_ tag: String, replacement: String, progress: (@Sendable (Int) async -> Void)? = nil) async throws {
        let tag = try TagValidation.normalize(tag), replacement = try TagValidation.normalize(replacement)
        guard Data(tag.utf8) != Data(replacement.utf8) else { return }
        let did = try await accountDID()
        let transport = NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http, expectedDID: did)
        let name = try JSONEncoder().encode(["rename", tag, replacement]).base64URL
        try await runTagJob(name: name, source: tag, did: did, onProgress: progress) { cursor in
            let input = LatrRenameBookmarkTagInput(tag: tag, replacement: replacement, limit: 25, cursor: cursor)
            return try await JSONDecoder().decode(BookmarkTagMutationSummary.self, from: transport.send(method: .renameBookmarkTag, parameters: [], body: JSONEncoder().encode(input)))
        }
    }
    public func deleteTag(_ tag: String, progress: (@Sendable (Int) async -> Void)? = nil) async throws {
        let tag = try TagValidation.normalize(tag)
        let did = try await accountDID(), client = client(for: did)
        try await runTagJob(name: "delete:\(tag)", source: tag, did: did, onProgress: progress) { cursor in
            try await client.deleteBookmarkTag(.init(tag: tag, limit: 25, cursor: cursor))
        }
    }
    private struct Progress: Codable, Sendable { var cursor: String?; var conflicts: Int = 0; var updated: Int? }
    private func runTagJob(name: String, source: String, did: String, onProgress: (@Sendable (Int) async -> Void)?, operation: @Sendable (String?) async throws -> BookmarkTagMutationSummary) async throws {
        let key = cacheKey("tagjob:\(Data(name.utf8).base64URL)", did: did)
        var progress = try await store.value(Progress.self, for: key) ?? Progress()
        for _ in 0..<3 {
            var seen = Set(progress.cursor.map { [$0] } ?? [])
            repeat {
                try Task.checkCancellation()
                let page: BookmarkTagMutationSummary
                do { page = try await operation(progress.cursor) }
                catch NativeError.http(let status, _) where status == 409 { page = try await operation(progress.cursor) }
                guard page.ok else { throw NativeError.invalidResponse }
                if let cursor = page.cursor, !seen.insert(cursor).inserted { throw NativeError.invalidResponse }
                progress.cursor = page.cursor; progress.updated = (progress.updated ?? 0) + page.updated
                try await store.set(progress, for: key)
                await onProgress?(progress.updated ?? 0)
            } while progress.cursor != nil
            let remaining = try await listTags(did: did).contains { Data($0.tag.utf8) == Data(source.utf8) && $0.count > 0 }
            if !remaining { try await store.remove(key); _ = try await listBookmarks(tag: nil, did: did); return }
        }
        throw NativeError.storage("Some bookmarks changed during tag editing. Retry to update the remaining bookmarks.")
    }
    public func migrateLegacy() async throws {
        let did = try await accountDID(), client = client(for: did)
        let key = cacheKey("migration", did: did)
        var progress = try await store.value(Progress.self, for: key) ?? Progress()
        var seen = Set(progress.cursor.map { [$0] } ?? [])
        repeat {
            try Task.checkCancellation()
            let page = try await client.migrateBookmarks(.init(limit: 25, cursor: progress.cursor))
            guard page.ok, page.cursor == nil || page.cursor != progress.cursor else { throw NativeError.invalidResponse }
            if let cursor = page.cursor, !seen.insert(cursor).inserted { throw NativeError.invalidResponse }
            progress.cursor = page.cursor; progress.conflicts += page.skippedConflict; try await store.set(progress, for: key)
        } while progress.cursor != nil
        try await store.remove(key)
        if progress.conflicts > 0 { throw NativeError.storage("Some legacy bookmarks conflicted with newer saves. Retry migration after reviewing your library.") }
        try await store.set(true, for: cacheKey("migrationComplete", did: did))
    }
    public func migrateLegacyIfNeeded() async throws {
        if try await store.value(Bool.self, for: accountKey("migrationComplete")) != true { try await migrateLegacy() }
    }
    public func syncMetadata() async throws {
        let did = try await accountDID(), client = client(for: did)
        let key = cacheKey("metadataSync", did: did)
        var progress = try await store.value(Progress.self, for: key) ?? Progress()
        var seen = Set(progress.cursor.map { [$0] } ?? [])
        repeat {
            try Task.checkCancellation()
            let page = try await client.syncBookmarkMetadata(.init(limit: 25, cursor: progress.cursor))
            guard page.ok, page.cursor == nil || page.cursor != progress.cursor else { throw NativeError.invalidResponse }
            if let cursor = page.cursor, !seen.insert(cursor).inserted { throw NativeError.invalidResponse }
            progress.cursor = page.cursor; progress.conflicts += page.skippedConflict; try await store.set(progress, for: key)
        } while progress.cursor != nil
        try await store.remove(key)
        if progress.conflicts > 0 { throw NativeError.storage("Some metadata changed during synchronization. Retry to complete the remaining items.") }
    }
    public func exportBookmarks() async throws -> Data {
        struct Export: Encodable { let exportedAt: Date; let did: String; let savedItems: [RepositoryRecord<CommunityBookmark>] }
        let did = try await accountDID()
        let rows = try await listBookmarks(tag: nil, did: did).map { RepositoryRecord(uri: $0.uri, cid: $0.cid, value: $0.value) }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(Export(exportedAt: Date(), did: did, savedItems: rows))
    }
    public func enqueueSave(subject: String, tags: [String] = [], expectedDID: String?) async throws -> PendingSave {
        let subject = try SharedLinkParser.validatedSubject(subject), tags = try TagValidation.normalize(tags)
        if let expectedDID {
            guard try await oauth.restoreSession()?.did == expectedDID else { throw NativeError.invalidIdentity }
        }
        // Bind the account the user actually reviewed; nil remains an unsigned draft even
        // when another process signs in between presentation and Save confirmation.
        let save = PendingSave(subject: subject, tags: tags, did: expectedDID, environment: configuration.environment)
        try await store.savePending(save)
        return save
    }
    public func pendingSaves() async throws -> [PendingSave] { try await store.pendingSaves(environment: configuration.environment) }
    public func removePendingSave(id: UUID) async throws { try await queueLock.withLock { try await self.store.removePending(id: id) } }
    public func updatePendingSave(id: UUID, subject: String, tags: [String]) async throws {
        try await queueLock.withLock { try await self.store.updatePending(id: id, subject: subject, tags: tags) }
    }
    public func adoptDraft(id: UUID, expectedDID: String) async throws -> PendingSave {
        try await queueLock.withLock {
            guard let session = try await self.oauth.restoreSession() else { throw NativeError.notAuthenticated }
            guard session.did == expectedDID else { throw NativeError.invalidIdentity }
            guard var save = try await self.pendingSaves().first(where: { $0.id == id }), save.did == nil else { throw NativeError.invalidIdentity }
            try await self.store.updatePending(id: id, subject: save.subject, tags: save.tags, adoptingDID: session.did)
            save.did = session.did
            return save
        }
    }
    public func drainPendingSaves() async throws {
        try await queueLock.withLock {
            guard let session = try await self.oauth.restoreSession() else { return }
            let rows = try await self.pendingSaves().filter { $0.did == session.did }
            for var row in rows {
                try Task.checkCancellation()
                // Session can change between requests; never publish another account's queue.
                guard try await self.oauth.restoreSession()?.did == row.did else { return }
                do {
                    try await self.save(subject: row.subject, tags: row.tags, expectedDID: row.did)
                    try await self.store.removePending(id: row.id)
                } catch {
                    row.lastError = error.localizedDescription; try await self.store.savePending(row)
                    throw error
                }
            }
        }
    }
}
