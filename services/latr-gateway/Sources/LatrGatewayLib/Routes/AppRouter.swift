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

    let latr = router.group("v1/latr")

    DeveloperRoutes.register(on: latr, services: services)

    latr.post("auth/probe") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let page: RecordList<SavedItem> = try await services.repositoryClient(for: auth).listRecords(
                in: auth.did,
                collection: .savedItem,
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
            let items = try await library.savedItems()
            return try jsonResponse(SavedItemsResponse(records: items))
        }
    }

    latr.post("migrate-lexicons") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let library = services.savedLibrary(for: auth)
            let summary = try await library.migrateLegacyLexiconsIfNeeded()
            return try jsonResponse(LexiconMigrationResponse(summary: summary))
        }
    }

    latr.post("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let body = try await decodeJSONBody(request, as: SaveBody.self)
            let library = services.savedLibrary(for: auth)

            switch body {
            case let .url(url):
                let result = try await SaveURLPipeline.run(
                    url: url,
                    library: library,
                    httpClient: services.httpClient,
                    repository: services.repositoryClient(for: auth),
                    subjectClient: services.federatedSubjectClient()
                )
                return try jsonResponse(
                    SaveOKResponse(
                        ok: true,
                        kind: result.kind,
                        subjectUri: result.subjectUri,
                        linkedWebUrl: result.linkedWebUrl,
                        storage: result.storage
                    ),
                    status: .created
                )
            case let .subject(subjectURI, linkedWebURL):
                let linked = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines)
                let normalizedLink: String? = {
                    guard let linked, !linked.isEmpty else { return nil }
                    return linked
                }()

                let resolver = SubjectPreviewResolver(
                    repository: services.repositoryClient(for: auth),
                    appView: services.federatedSubjectClient(),
                    untyped: services.federatedSubjectClient()
                )
                let subjectPreview = await resolver.preview(for: subjectURI)
                var mergedPreview = subjectPreview
                if let normalizedLink,
                   let ogFields = await fetchOpenGraphMetadata(
                       url: normalizedLink,
                       httpClient: services.httpClient
                   )
                {
                    mergedPreview = OpenGraphMerger.merge(
                        primary: subjectPreview,
                        fallback: openGraphPreview(from: ogFields)
                    )
                }

                let previewForSave = openGraphPreviewHasContent(mergedPreview) ? mergedPreview : nil

                try await library.save(
                    subjectURI: subjectURI,
                    linkedWebURL: normalizedLink,
                    preview: previewForSave
                )
                let storage = LexiconURI.isExternalWrapper(subjectURI) ? "external" : "native"
                return try jsonResponse(
                    SaveOKResponse(
                        ok: true,
                        kind: "subject",
                        subjectUri: subjectURI,
                        linkedWebUrl: linked?.isEmpty == false ? linked : nil,
                        storage: storage
                    ),
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
            let key = RecordKey.key(forSubjectURI: subjectURI)
            let record = try await library.savedItem(withKey: key)
            return try jsonResponse(SavedItemLookupResponse(record: record))
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
                try await library.setState(ofSavedItemWithKey: decodedRkey, to: body.state)
            } catch SavedLibraryError.itemNotFound {
                throw GatewayError(status: .notFound, message: "Saved item not found", code: "not_found")
            }
            return try jsonResponse(SimpleOKResponse(ok: true))
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
            try await library.removeSavedItem(withKey: decodedRkey)
            return try jsonResponse(SimpleOKResponse(ok: true))
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
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try await authenticateRequest(
            request,
            config: services.config,
            store: services.developerStore,
            httpClient: services.httpClient
        )
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
