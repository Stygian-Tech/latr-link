import Foundation
import Hummingbird
import LatrKit

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

    LatrXRPCRoutes.register(on: router, services: services)

    let latr = router.group("v1/latr")

    DeveloperRoutes.register(on: latr, services: services)

    latr.post("auth/probe") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            try jsonResponse(try await GatewayOperations.authProbe(auth: auth, services: services))
        }
    }

    latr.get("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let params = try SavesPageParams.parse(
                limit: request.uri.queryParameters.get("limit"),
                cursor: request.uri.queryParameters.get("cursor")
            )
            let page = try await services.savedLibrary(for: auth).bookmarks(
                limit: params?.limit ?? 100,
                startingAfter: params?.cursor
            )
            return try deprecatedJSONResponse(
                LegacyBookmarkAdapterList(
                    records: page.records.map(LegacyBookmarkAdapterRecord.init),
                    cursor: params == nil ? nil : page.cursor
                ),
                successor: "/xrpc/link.latr.bookmarks.listBookmarks"
            )
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
            return try deprecatedJSONResponse(
                try await BookmarkGatewayOperations.migrate(
                    input: LatrMigrateBookmarksInput(),
                    auth: auth,
                    services: services
                ),
                successor: "/xrpc/link.latr.bookmarks.migrateLegacy"
            )
        }
    }

    latr.post("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let body = try await decodeJSONBody(request, as: SaveBody.self)
            switch body {
            case let .url(url):
                let bookmark = try await BookmarkGatewayOperations.save(
                    input: LatrSaveBookmarkInput(subject: url),
                    auth: auth,
                    services: services
                )
                return try deprecatedJSONResponse(
                    SaveOKResponse(ok: true, kind: "url", subjectUri: bookmark.value.subject, linkedWebUrl: bookmark.value.subject, storage: "native"),
                    successor: "/xrpc/link.latr.bookmarks.saveBookmark",
                    status: .created
                )
            case let .subject(subjectURI, linkedWebURL):
                let bookmark = try await BookmarkGatewayOperations.save(
                    input: LatrSaveBookmarkInput(subject: subjectURI),
                    auth: auth,
                    services: services
                )
                if let linkedWebURL,
                   let preview = await resolveOpenGraphForURL(url: linkedWebURL, httpClient: services.httpClient)
                {
                    try? await services.previewStore.store(preview, for: bookmark.value.subject)
                }
                return try deprecatedJSONResponse(
                    SaveOKResponse(ok: true, kind: "subject", subjectUri: bookmark.value.subject, linkedWebUrl: linkedWebURL, storage: "native"),
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

            let record = try await services.savedLibrary(for: auth).bookmark(subject: subjectURI)
                .map(LegacyBookmarkAdapterRecord.init)
            return try deprecatedJSONResponse(
                LegacyBookmarkAdapterLookup(record: record),
                successor: "/xrpc/link.latr.bookmarks.getBookmark"
            )
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
            let bookmarkURI = "at://\(auth.did)/\(LexiconCollection.bookmark.identifier)/\(decodedRkey)"
            return try deprecatedJSONResponse(
                try await BookmarkGatewayOperations.setState(
                    input: LatrSetBookmarkStateInput(bookmarkUri: bookmarkURI, state: body.state),
                    auth: auth,
                    services: services
                ),
                successor: "/xrpc/link.latr.bookmarks.setState"
            )
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
            let bookmarkURI = "at://\(auth.did)/\(LexiconCollection.bookmark.identifier)/\(decodedRkey)"
            return try deprecatedJSONResponse(
                try await BookmarkGatewayOperations.delete(
                    input: LatrDeleteBookmarkInput(bookmarkUri: bookmarkURI),
                    auth: auth,
                    services: services
                ),
                successor: "/xrpc/link.latr.bookmarks.deleteBookmark"
            )
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
            let result = await GatewayOperations.resolveURL(raw, services: services)
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

            let og = try await GatewayOperations.openGraph(raw, services: services)
            return try jsonResponse(og)
        }
    }

    return router
}

func handleProtected(
    request: Request,
    services: GatewayServices,
    upstreamDpopProof: String? = nil,
    errorResponder: @Sendable (Error) -> Response = errorResponse,
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
        return errorResponder(error)
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
    path.contains("/og-preview")
        || path.contains("/discover/at-uri")
        || path.contains(LatrXRPCMethod.getOpenGraph.rawValue)
        || path.contains(LatrXRPCMethod.resolveURL.rawValue)
}
