import Foundation
import LatrKit

/// Protocol-independent application operations shared by XRPC and temporary REST adapters.
public enum GatewayOperations {
    public static func authProbe(
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> AuthProbeResponse {
        let page: RecordList<CommunityBookmark> = try await services.repositoryClient(for: auth).listRecords(
            in: auth.did,
            collection: .bookmark,
            limit: 1,
            startingAfter: nil
        )
        return AuthProbeResponse(
            ok: true,
            did: auth.did,
            clientId: auth.clientID,
            pdsWriteThrough: true,
            sampleCount: page.records.count,
            upstreamDpop: auth.upstreamDpopProof != nil
        )
    }

    public static func listItems(
        auth: AuthContext,
        services: GatewayServices,
        limit: Int,
        cursor: String?
    ) async throws -> SavedItemsResponse {
        let page: RecordList<SavedItem> = try await services.repositoryClient(for: auth).listRecords(
            in: auth.did,
            collection: .savedItem,
            limit: min(max(limit, 1), 100),
            startingAfter: cursor
        )
        return SavedItemsResponse(records: page.records, cursor: page.cursor)
    }

    public static func listAllItems(
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SavedItemsResponse {
        let records = try await services.savedLibrary(for: auth).savedItems()
        return SavedItemsResponse(records: records)
    }

    public static func getItem(
        subjectURI: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SavedItemLookupResponse {
        let trimmed = subjectURI.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw GatewayError(status: .badRequest, message: "subjectUri is required", code: "invalid_request")
        }

        let key = RecordKey.key(forSubjectURI: trimmed)
        let record: RepositoryRecord<SavedItem>?
        if auth.accessTokenSignatureVerified {
            record = try await services.savedLibrary(for: auth).savedItem(withKey: key)
        } else {
            record = try await services.repositoryClient(for: auth).authenticatedRecord(
                in: auth.did,
                collection: .savedItem,
                withKey: key
            )
        }
        return SavedItemLookupResponse(record: record)
    }

    public static func saveURL(
        _ url: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SaveOKResponse {
        let result = try await SaveURLPipeline.run(
            url: url,
            library: services.savedLibrary(for: auth),
            httpClient: services.httpClient,
            repository: services.repositoryClient(for: auth),
            subjectClient: services.federatedSubjectClient()
        )
        return SaveOKResponse(
            ok: true,
            kind: result.kind,
            subjectUri: result.subjectUri,
            linkedWebUrl: result.linkedWebUrl,
            storage: result.storage
        )
    }

    public static func saveSubject(
        subjectURI: String,
        linkedWebURL: String?,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SaveOKResponse {
        let subjectURI = subjectURI.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !subjectURI.isEmpty else {
            throw GatewayError(status: .badRequest, message: "subjectUri is required", code: "invalid_request")
        }
        let linked = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedLink = linked.flatMap { $0.isEmpty ? nil : $0 }

        let resolver = SubjectPreviewResolver(
            repository: services.repositoryClient(for: auth),
            appView: services.federatedSubjectClient(),
            untyped: services.federatedSubjectClient()
        )
        let subjectPreview = await resolver.preview(for: subjectURI)
        var mergedPreview = subjectPreview
        if let normalizedLink,
           let fields = await fetchOpenGraphMetadata(url: normalizedLink, httpClient: services.httpClient)
        {
            mergedPreview = OpenGraphMerger.merge(
                primary: subjectPreview,
                fallback: OpenGraphPreview(
                    title: fields.title,
                    description: fields.description,
                    image: fields.image,
                    siteName: fields.siteName,
                    author: fields.author
                )
            )
        }

        let hasPreview = [
            mergedPreview.title,
            mergedPreview.description,
            mergedPreview.image,
            mergedPreview.siteName,
            mergedPreview.author,
        ].contains { value in
            guard let value else { return false }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        try await services.savedLibrary(for: auth).save(
            subjectURI: subjectURI,
            linkedWebURL: normalizedLink,
            preview: hasPreview ? mergedPreview : nil
        )
        return SaveOKResponse(
            ok: true,
            kind: "subject",
            subjectUri: subjectURI,
            linkedWebUrl: normalizedLink,
            storage: LexiconURI.isExternalWrapper(subjectURI) ? "external" : "native"
        )
    }

    public static func setState(
        itemRkey: String,
        state: SavedItemState,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        let key = itemRkey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            throw GatewayError(status: .badRequest, message: "itemRkey is required", code: "invalid_request")
        }
        do {
            try await services.savedLibrary(for: auth).setState(ofSavedItemWithKey: key, to: state)
        } catch SavedLibraryError.itemNotFound {
            throw GatewayError(status: .notFound, message: "Saved item not found", code: "saved_item_not_found")
        }
        return SimpleOKResponse(ok: true)
    }

    public static func deleteItem(
        itemRkey: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        let key = itemRkey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            throw GatewayError(status: .badRequest, message: "itemRkey is required", code: "invalid_request")
        }
        try await services.savedLibrary(for: auth).removeSavedItem(withKey: key)
        return SimpleOKResponse(ok: true)
    }

    public static func migrateLegacy(
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> LexiconMigrationResponse {
        let summary = try await services.savedLibrary(for: auth).migrateLegacyLexiconsIfNeeded()
        return LexiconMigrationResponse(summary: summary)
    }

    public static func resolveURL(_ url: String, services: GatewayServices) async -> DiscoverAtURIResult {
        await discoverAtURIFromURL(
            url,
            httpClient: services.httpClient,
            subjectClient: services.federatedSubjectClient()
        )
    }

    public static func openGraph(_ url: String, services: GatewayServices) async throws -> OpenGraphFields {
        guard let parsed = URL(string: url),
              let scheme = parsed.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            throw GatewayError(status: .badRequest, message: "Invalid URL", code: "invalid_url")
        }
        guard let fields = await resolveOpenGraphForURL(
            url: parsed.absoluteString,
            httpClient: services.httpClient
        ) else {
            throw GatewayError(status: .badRequest, message: "Invalid URL", code: "invalid_url")
        }
        return fields
    }
}
