import Foundation
import LatrKit

public enum BookmarkGatewayOperations {
    public static func list(
        auth: AuthContext,
        services: GatewayServices,
        limit: Int,
        cursor: String?,
        tag: String? = nil
    ) async throws -> GatewayBookmarkList {
        let page = try await services.savedLibrary(for: auth).bookmarks(
            limit: limit,
            startingAfter: cursor,
            taggedWith: tag
        )
        let views = await page.records.asyncMap { view in
            GatewayBookmarkView(view, preview: try? await services.previewStore.preview(for: view.value.subject))
        }
        return GatewayBookmarkList(bookmarks: views, cursor: page.cursor)
    }

    public static func listTags(
        auth: AuthContext,
        services: GatewayServices,
        limit: Int,
        cursor: String?
    ) async throws -> BookmarkTagList {
        try await services.savedLibrary(for: auth).bookmarkTags(limit: limit, startingAfter: cursor)
    }

    public static func get(
        subject: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> GatewayBookmarkLookup {
        guard let view = try await services.savedLibrary(for: auth).bookmark(subject: subject) else {
            return GatewayBookmarkLookup(bookmark: nil)
        }
        let preview = try? await services.previewStore.preview(for: view.value.subject)
        return GatewayBookmarkLookup(bookmark: GatewayBookmarkView(view, preview: preview))
    }

    public static func save(
        input: LatrSaveBookmarkInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> GatewayBookmarkView {
        let view = try await services.savedLibrary(for: auth).saveBookmark(subject: input.subject, tags: input.tags)
        var preview = try? await services.previewStore.preview(for: view.value.subject)
        if preview == nil,
           let url = URL(string: view.value.subject),
           ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
           let resolved = await resolveOpenGraphForURL(url: view.value.subject, httpClient: services.httpClient)
        {
            try? await services.previewStore.store(resolved, for: view.value.subject)
            preview = resolved
        }
        return GatewayBookmarkView(view, preview: preview)
    }

    public static func syncMetadata(
        input: LatrSyncBookmarkMetadataInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> BookmarkMetadataSyncSummary {
        try await services.savedLibrary(for: auth).syncBookmarkMetadata(
            limit: try syncMetadataLimit(input.limit),
            startingAfter: input.cursor
        )
    }

    static func syncMetadataLimit(_ requested: Int?) throws -> Int {
        let limit = requested ?? 50
        guard (1 ... 100).contains(limit) else {
            throw GatewayError(
                status: .badRequest,
                message: "limit must be between 1 and 100",
                code: "invalid_request"
            )
        }
        return limit
    }

    public static func setState(
        input: LatrSetBookmarkStateInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        do {
            try await services.savedLibrary(for: auth).setState(ofBookmarkURI: input.bookmarkUri, to: input.state)
        } catch SavedLibraryError.bookmarkNotFound {
            throw GatewayError(status: .notFound, message: "Bookmark not found", code: "bookmark_not_found")
        }
        return SimpleOKResponse(ok: true)
    }

    public static func setTags(
        input: LatrSetBookmarkTagsInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> GatewayBookmarkView {
        let view = try await services.savedLibrary(for: auth).setTags(
            ofBookmarkURI: input.bookmarkUri,
            to: input.tags
        )
        return GatewayBookmarkView(
            view,
            preview: try? await services.previewStore.preview(for: view.value.subject)
        )
    }

    public static func renameTag(
        input: LatrRenameBookmarkTagInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> BookmarkTagMutationSummary {
        try await services.savedLibrary(for: auth).renameTag(
            input.tag,
            to: input.replacement,
            limit: try tagMutationLimit(input.limit),
            continuingFrom: input.cursor
        )
    }

    public static func deleteTag(
        input: LatrDeleteBookmarkTagInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> BookmarkTagMutationSummary {
        try await services.savedLibrary(for: auth).deleteTag(
            input.tag,
            limit: try tagMutationLimit(input.limit),
            continuingFrom: input.cursor
        )
    }

    static func tagMutationLimit(_ requested: Int?) throws -> Int {
        let limit = requested ?? 25
        guard (1 ... 25).contains(limit) else {
            throw GatewayError(
                status: .badRequest,
                message: "limit must be between 1 and 25",
                code: "invalid_request"
            )
        }
        return limit
    }

    public static func delete(
        input: LatrDeleteBookmarkInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        do {
            try await services.savedLibrary(for: auth).removeBookmark(uri: input.bookmarkUri)
        } catch SavedLibraryError.bookmarkNotFound {
            throw GatewayError(status: .notFound, message: "Bookmark not found", code: "bookmark_not_found")
        }
        return SimpleOKResponse(ok: true)
    }

    public static func migrate(
        input: LatrMigrateBookmarksInput,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> BookmarkMigrationSummary {
        let cached = try await seedLegacyPreviews(auth: auth, services: services)
        var summary = try await services.savedLibrary(for: auth).migrateBookmarks(
            limit: input.limit ?? 25,
            cursor: input.cursor
        )
        summary.cached = cached
        return summary
    }

    private static func seedLegacyPreviews(auth: AuthContext, services: GatewayServices) async throws -> Int {
        let repository = services.repositoryClient(for: auth)
        var cached = 0
        for collection in [LexiconCollection.external, .legacyExternal] {
            var cursor: String?
            repeat {
                let page: RecordList<ExternalSave> = try await repository.listRecords(
                    in: auth.did, collection: collection, limit: 100, startingAfter: cursor
                )
                for record in page.records {
                    let fields = OpenGraphFields(
                        title: record.value.title,
                        description: record.value.excerpt,
                        image: record.value.image,
                        siteName: record.value.site,
                        author: record.value.author
                    )
                    let original = record.value.url.trimmingCharacters(in: .whitespacesAndNewlines)
                    let subject = original.hasPrefix("https://") || original.hasPrefix("http://")
                        ? original : record.value.normalizedUrl
                    if fields.hasContent, (try? await services.previewStore.store(fields, for: subject)) != nil {
                        cached += 1
                    }
                }
                cursor = page.cursor
            } while cursor != nil
        }
        for collection in [LexiconCollection.savedItem, .legacySavedItem] {
            var cursor: String?
            repeat {
                let page: RecordList<SavedItem> = try await repository.listRecords(
                    in: auth.did, collection: collection, limit: 100, startingAfter: cursor
                )
                for record in page.records {
                    let fields = OpenGraphFields(
                        title: record.value.previewTitle,
                        description: record.value.previewExcerpt,
                        image: record.value.previewImage,
                        siteName: record.value.previewSite,
                        author: record.value.previewAuthor
                    )
                    let linked = record.value.linkedWebUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
                    let subject = linked?.hasPrefix("https://") == true || linked?.hasPrefix("http://") == true
                        ? linked! : record.value.subjectUri
                    if fields.hasContent, (try? await services.previewStore.store(fields, for: subject)) != nil {
                        cached += 1
                    }
                }
                cursor = page.cursor
            } while cursor != nil
        }
        return cached
    }
}

private extension Array {
    func asyncMap<T>(_ transform: (Element) async -> T) async -> [T] {
        var result: [T] = []
        result.reserveCapacity(count)
        for element in self { result.append(await transform(element)) }
        return result
    }
}

private extension OpenGraphFields {
    var hasContent: Bool {
        [title, description, image, siteName, author].contains {
            guard let value = $0 else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}
