import AsyncHTTPClient
import Foundation
import Hummingbird
import LatrKit
import Logging

public func buildRouter(services: GatewayServices) -> Router<BasicRequestContext> {
    let router = Router(context: BasicRequestContext.self)
    router.add(middleware: CorsMiddleware())

    router.get("health") { _, _ in
        try jsonResponse(HealthResponse(status: "ok", service: "latr-gateway"))
    }

    OAuthMetadataRoutes.register(
        on: router,
        oauthRedirectOrigin: services.config.oauthPublicOrigin,
        oauthLatrkitRedirectOrigin: services.config.oauthLatrkitPublicOrigin
    )

    let xrpc = router.group("xrpc")

    xrpc.get("link.latr.bookmarks.listBookmarks") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let limit = min(max(Int(request.uri.queryParameters.get("limit") ?? "50") ?? 50, 1), 100)
            let cursor = request.uri.queryParameters.get("cursor")
            let page = try await services.savedLibrary(for: auth).bookmarks(limit: limit, startingAfter: cursor)
            var bookmarks: [GatewayBookmarkView] = []
            for view in page.records {
                bookmarks.append(GatewayBookmarkView(view, preview: try? await services.previewStore.preview(for: view.value.subject)))
            }
            return try jsonResponse(GatewayBookmarkList(bookmarks: bookmarks, cursor: page.cursor))
        }
    }

    xrpc.get("link.latr.bookmarks.getBookmark") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            guard let subject = request.uri.queryParameters.get("subject")?.trimmingCharacters(in: .whitespacesAndNewlines), !subject.isEmpty else {
                throw GatewayError(status: .badRequest, message: "Missing bookmark subject", code: "InvalidRequest")
            }
            let found = try await services.savedLibrary(for: auth).bookmark(subject: subject)
            let response: GatewayBookmarkView?
            if let found {
                response = GatewayBookmarkView(found, preview: try? await services.previewStore.preview(for: found.value.subject))
            } else {
                response = nil
            }
            return try jsonResponse(GatewayBookmarkLookup(bookmark: response))
        }
    }

    xrpc.post("link.latr.bookmarks.saveBookmark") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let input = try await decodeJSONBody(request, as: LatrSaveBookmarkInput.self)
            let bookmark = try await services.savedLibrary(for: auth).saveBookmark(subject: input.subject, tags: input.tags)
            var preview = try? await services.previewStore.preview(for: bookmark.value.subject)
            if preview == nil, bookmark.value.subject.hasPrefix("http"),
               let resolved = await resolveOpenGraphForURL(url: bookmark.value.subject, httpClient: services.httpClient)
            {
                preview = resolved
                try? await services.previewStore.store(resolved, for: bookmark.value.subject)
            }
            return try jsonResponse(GatewayBookmarkView(bookmark, preview: preview), status: .created)
        }
    }

    xrpc.post("link.latr.bookmarks.setState") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let input = try await decodeJSONBody(request, as: LatrSetBookmarkStateInput.self)
            try await services.savedLibrary(for: auth).setState(ofBookmarkURI: input.bookmarkUri, to: input.state)
            return try jsonResponse(LatrSimpleOK(ok: true))
        }
    }

    xrpc.post("link.latr.bookmarks.deleteBookmark") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let input = try await decodeJSONBody(request, as: LatrDeleteBookmarkInput.self)
            try await services.savedLibrary(for: auth).removeBookmark(uri: input.bookmarkUri)
            return try jsonResponse(LatrSimpleOK(ok: true))
        }
    }

    xrpc.post("link.latr.bookmarks.migrateLegacy") { request, _ in
        do {
            let input = try await decodeJSONBody(request, as: MigrateBookmarksBody.self)
            return await handleProtected(
                request: request,
                services: services,
                upstreamDpopProof: input.upstreamDpopProof
            ) { auth in
                let cached = try await seedLegacyBookmarkPreviews(auth: auth, services: services)
                var summary = try await services.savedLibrary(for: auth).migrateBookmarks(
                    limit: input.limit ?? 25,
                    cursor: input.cursor
                )
                summary.cached = cached
                return try jsonResponse(summary)
            }
        } catch {
            return errorResponse(error)
        }
    }

    let latr = router.group("v1/latr")

    DeveloperRoutes.register(on: latr, services: services)

    latr.post("auth/probe") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let page: RecordList<CommunityBookmark> = try await services.repositoryClient(for: auth).listRecords(
                in: auth.did,
                collection: .bookmark,
                limit: 1,
                startingAfter: nil
            )

            return try jsonResponse(
                AuthProbeResponse(
                    ok: true,
                    did: auth.did,
                    clientId: auth.clientID,
                    pdsWriteThrough: true,
                    sampleCount: page.records.count,
                    upstreamDpop: auth.upstreamDpopProof != nil
                )
            )
        }
    }

    latr.get("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let library = services.savedLibrary(for: auth)
            let params = try SavesPageParams.parse(
                limit: request.uri.queryParameters.get("limit"),
                cursor: request.uri.queryParameters.get("cursor")
            )
            if let params {
                let page = try await library.bookmarks(
                    limit: params.limit,
                    startingAfter: params.cursor
                )
                return try deprecatedJSONResponse(LegacyBookmarkAdapterList(records: page.records.map(LegacyBookmarkAdapterRecord.init), cursor: page.cursor), successor: "/xrpc/link.latr.bookmarks.listBookmarks")
            }
            var records: [LegacyBookmarkAdapterRecord] = []
            var cursor: String?
            repeat {
                let page = try await library.bookmarks(limit: 100, startingAfter: cursor)
                records.append(contentsOf: page.records.map(LegacyBookmarkAdapterRecord.init))
                cursor = page.cursor
            } while cursor != nil
            return try deprecatedJSONResponse(LegacyBookmarkAdapterList(records: records, cursor: nil), successor: "/xrpc/link.latr.bookmarks.listBookmarks")
        }
    }

    latr.post("migrate-lexicons") { request, _ in
        var bodyProof: String?
        if extractUpstreamDPOPHeader(from: request.headers) == nil {
            do {
                let body = try await decodeJSONBody(request, as: MigrateLexiconsBody.self)
                let proof = body.upstreamDpopProof.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !proof.isEmpty else {
                    throw GatewayError(
                        status: .badRequest,
                        message: "Missing upstream DPoP proof pool",
                        code: "missing_upstream_dpop"
                    )
                }
                bodyProof = proof
            } catch {
                return errorResponse(error)
            }
        }
        return await handleProtected(
            request: request,
            services: services,
            upstreamDpopProof: bodyProof
        ) { auth in
            let library = services.savedLibrary(for: auth)
            let cached = try await seedLegacyBookmarkPreviews(auth: auth, services: services)
            var summary = try await library.migrateBookmarks()
            summary.cached = cached
            return try deprecatedJSONResponse(summary, successor: "/xrpc/link.latr.bookmarks.migrateLegacy")
        }
    }

    latr.post("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let body = try await decodeJSONBody(request, as: SaveBody.self)
            let library = services.savedLibrary(for: auth)

            switch body {
            case let .url(url):
                let bookmark = try await library.saveBookmark(subject: url)
                if let preview = await resolveOpenGraphForURL(url: url, httpClient: services.httpClient) {
                    try? await services.previewStore.store(preview, for: url)
                }
                return try deprecatedJSONResponse(
                    SaveOKResponse(
                        ok: true,
                        kind: "url",
                        subjectUri: bookmark.value.subject,
                        linkedWebUrl: bookmark.value.subject,
                        storage: "native"
                    ),
                    successor: "/xrpc/link.latr.bookmarks.saveBookmark",
                    status: .created
                )
            case let .subject(subjectURI, linkedWebURL):
                let linked = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines)
                let normalizedLink: String? = {
                    guard let linked, !linked.isEmpty else { return nil }
                    return linked
                }()

                let bookmark = try await library.saveBookmark(subject: subjectURI)
                if let normalizedLink, let preview = await resolveOpenGraphForURL(url: normalizedLink, httpClient: services.httpClient) {
                    try? await services.previewStore.store(preview, for: subjectURI)
                }
                return try deprecatedJSONResponse(
                    SaveOKResponse(
                        ok: true,
                        kind: "subject",
                        subjectUri: bookmark.value.subject,
                        linkedWebUrl: linked?.isEmpty == false ? linked : nil,
                        storage: "native"
                    ),
                    successor: "/xrpc/link.latr.bookmarks.saveBookmark",
                    status: .created
                )
            }
        }
    }

    latr.get("saves/subject") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            guard let subjectURI = request.uri.queryParameters.get("subjectUri")?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !subjectURI.isEmpty
            else {
                throw GatewayError(status: .badRequest, message: "missing subjectUri", code: "missing_subject")
            }

            let library = services.savedLibrary(for: auth)
            let record = try await library.bookmark(subject: subjectURI).map(LegacyBookmarkAdapterRecord.init)
            return try deprecatedJSONResponse(LegacyBookmarkAdapterLookup(record: record), successor: "/xrpc/link.latr.bookmarks.getBookmark")
        }
    }

    latr.patch("saves/:itemRkey/state") { request, context in
        await handleProtected(request: request, services: services) { auth in
            let itemRkey = (try? context.parameters.require("itemRkey"))
                ?? request.uri.path.split(separator: "/").dropLast().last.map(String.init)
                ?? ""
            let decodedRkey = itemRkey.removingPercentEncoding ?? itemRkey
            guard !decodedRkey.isEmpty else {
                throw GatewayError(status: .notFound, message: "Not found", code: "not_found")
            }
            let body = try await decodeJSONBody(request, as: StatePatchBody.self)
            let library = services.savedLibrary(for: auth)
            do {
                let uri = "at://\(auth.did)/\(LexiconCollection.bookmark.identifier)/\(decodedRkey)"
                try await library.setState(ofBookmarkURI: uri, to: body.state)
            } catch SavedLibraryError.bookmarkNotFound {
                throw GatewayError(status: .notFound, message: "Saved item not found", code: "not_found")
            }
            return try deprecatedJSONResponse(SimpleOKResponse(ok: true), successor: "/xrpc/link.latr.bookmarks.setState")
        }
    }

    latr.delete("saves/:itemRkey") { request, context in
        await handleProtected(request: request, services: services) { auth in
            let itemRkey = (try? context.parameters.require("itemRkey"))
                ?? request.uri.path.split(separator: "/").last.map(String.init)
                ?? ""
            let decodedRkey = itemRkey.removingPercentEncoding ?? itemRkey
            guard !decodedRkey.isEmpty else {
                throw GatewayError(status: .notFound, message: "Not found", code: "not_found")
            }
            let library = services.savedLibrary(for: auth)
            let uri = "at://\(auth.did)/\(LexiconCollection.bookmark.identifier)/\(decodedRkey)"
            try await library.removeBookmark(uri: uri)
            return try deprecatedJSONResponse(SimpleOKResponse(ok: true), successor: "/xrpc/link.latr.bookmarks.deleteBookmark")
        }
    }

    latr.get("discover/at-uri") { request, _ in
        await handleProtected(request: request, services: services) { _ in
            guard let raw = request.uri.queryParameters.get("url")?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !raw.isEmpty
            else {
                throw GatewayError(status: .badRequest, message: "missing url", code: "missing_url")
            }
            let result = await discoverAtURIFromURL(
                raw,
                httpClient: services.httpClient,
                subjectClient: services.federatedSubjectClient()
            )
            return try jsonResponse(result)
        }
    }

    latr.get("og-preview") { request, _ in
        await handleProtected(request: request, services: services) { _ in
            guard let raw = request.uri.queryParameters.get("url")?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !raw.isEmpty
            else {
                throw GatewayError(status: .badRequest, message: "missing url", code: "missing_url")
            }

            guard let parsed = URL(string: raw),
                  let scheme = parsed.scheme?.lowercased(),
                  scheme == "http" || scheme == "https"
            else {
                throw GatewayError(status: .badRequest, message: "invalid url", code: "invalid_url")
            }

            guard let og = await resolveOpenGraphForURL(
                url: parsed.absoluteString,
                httpClient: services.httpClient
            ) else {
                throw GatewayError(status: .badRequest, message: "invalid url", code: "invalid_url")
            }
            return try jsonResponse(og)
        }
    }

    return router
}

private func seedLegacyBookmarkPreviews(auth: AuthContext, services: GatewayServices) async throws -> Int {
    let repository = services.repositoryClient(for: auth)
    var cached = 0
    for collection in [LexiconCollection.external, .legacyExternal] {
        var cursor: String?
        repeat {
            let page: RecordList<ExternalSave> = try await repository.listRecords(
                in: auth.did, collection: collection, limit: 100, startingAfter: cursor
            )
            for record in page.records {
                let preview = OpenGraphFields(
                    title: record.value.title,
                    description: record.value.excerpt,
                    image: record.value.image,
                    siteName: record.value.site,
                    author: record.value.author
                )
                let original = record.value.url.trimmingCharacters(in: .whitespacesAndNewlines)
                let subject = original.hasPrefix("https://") || original.hasPrefix("http://")
                    ? original : record.value.normalizedUrl
                if openGraphPreviewHasContent(openGraphPreview(from: preview)),
                   (try? await services.previewStore.store(preview, for: subject)) != nil
                {
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
                let preview = OpenGraphFields(
                    title: record.value.previewTitle,
                    description: record.value.previewExcerpt,
                    image: record.value.previewImage,
                    siteName: record.value.previewSite,
                    author: record.value.previewAuthor
                )
                let linked = record.value.linkedWebUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
                let subject = linked?.hasPrefix("https://") == true || linked?.hasPrefix("http://") == true
                    ? linked! : record.value.subjectUri
                if openGraphPreviewHasContent(openGraphPreview(from: preview)),
                   (try? await services.previewStore.store(preview, for: subject)) != nil
                {
                    cached += 1
                }
            }
            cursor = page.cursor
        } while cursor != nil
    }
    return cached
}

private func openGraphPreview(from fields: OpenGraphFields) -> OpenGraphPreview {
    OpenGraphPreview(
        title: fields.title,
        description: fields.description,
        image: fields.image,
        siteName: fields.siteName,
        author: fields.author
    )
}

private func openGraphPreviewHasContent(_ preview: OpenGraphPreview) -> Bool {
    func filled(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    return filled(preview.title)
        || filled(preview.description)
        || filled(preview.image)
        || filled(preview.siteName)
        || filled(preview.author)
}

private func handleProtected(
    request: Request,
    services: GatewayServices,
    upstreamDpopProof: String? = nil,
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try await authenticateRequest(
            request,
            config: services.config,
            store: services.developerStore,
            httpClient: services.httpClient,
            upstreamDpopProof: upstreamDpopProof
        )
        try await attestPDSOAuthSessionIfNeeded(auth: auth, path: request.uri.path) {
            try await services.repositoryClient(for: auth).attestOAuthSession()
        }
        if let clientID = auth.clientID {
            try await services.developerStore.assertWithinDailyLimit(clientID: clientID)
        }
        let response = try await handler(auth)
        if let clientID = auth.clientID, (200 ... 299).contains(response.status.code) {
            try await services.developerStore.recordUsage(
                clientID: clientID,
                routeFamily: routeFamily(for: request.uri.path)
            )
        }
        return response
    } catch {
        return errorResponse(error)
    }
}

func attestPDSOAuthSessionIfNeeded(
    auth: AuthContext,
    path: String,
    attest: @Sendable () async throws -> Void
) async throws {
    guard !auth.accessTokenSignatureVerified, isStrictEnrichmentRoute(path) else { return }
    try await attest()
}

private func isStrictEnrichmentRoute(_ path: String) -> Bool {
    path.contains("/og-preview") || path.contains("/discover/at-uri")
}
