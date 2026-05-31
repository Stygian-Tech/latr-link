import AsyncHTTPClient
import Foundation
import Hummingbird
import LatrKit
import Logging

public struct GatewayServices: Sendable {
    public let config: GatewayConfig
    public let httpClient: HTTPClient
    public let developerStore: any DeveloperStore

    public init(config: GatewayConfig, httpClient: HTTPClient, developerStore: any DeveloperStore) {
        self.config = config
        self.httpClient = httpClient
        self.developerStore = developerStore
    }

    public static func make(
        config: GatewayConfig,
        httpClient: HTTPClient,
        logger: Logger = Logger(label: "latr-gateway")
    ) -> GatewayServices {
        GatewayServices(
            config: config,
            httpClient: httpClient,
            developerStore: DeveloperStoreFactory.make(config: config, logger: logger)
        )
    }

    public func repositoryClient(for auth: AuthContext) -> PDSRepositoryClient {
        PDSRepositoryClient(auth: auth, plcURL: config.plcURL, httpClient: httpClient)
    }

    public func savedLibrary(for auth: AuthContext) -> SavedLibrary {
        SavedLibrary(repository: repositoryClient(for: auth), repositoryDID: auth.did)
    }
}

public struct HealthResponse: Encodable, Sendable {
    public let status: String
    public let service: String
}

public struct AuthProbeResponse: Encodable, Sendable {
    public let ok: Bool
    public let did: String
    public let clientId: String?
    public let pdsWriteThrough: Bool
    public let sampleCount: Int
    public let upstreamDpop: Bool
}

public enum SaveBody: Decodable, Sendable {
    case url(String)
    case subject(subjectUri: String, linkedWebUrl: String?)

    enum CodingKeys: String, CodingKey {
        case kind
        case url
        case subjectUri
        case linkedWebUrl
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "url":
            self = .url(try container.decode(String.self, forKey: .url))
        case "subject":
            self = .subject(
                subjectUri: try container.decode(String.self, forKey: .subjectUri),
                linkedWebUrl: try container.decodeIfPresent(String.self, forKey: .linkedWebUrl)
            )
        default:
            throw GatewayError(status: .badRequest, message: "invalid save body", code: "invalid_body")
        }
    }
}

public struct SaveOKResponse: Encodable, Sendable {
    public let ok: Bool
    public let kind: String
}

public struct StatePatchBody: Decodable, Sendable {
    public let state: SavedItemState
}

public struct SimpleOKResponse: Encodable, Sendable {
    public let ok: Bool
}

public struct SavedItemsResponse: Encodable, Sendable {
    public let records: [RepositoryRecord<SavedItem>]
}

public struct SavedItemLookupResponse: Encodable, Sendable {
    public let record: RepositoryRecord<SavedItem>?
}

public struct OGPreviewFailureResponse: Encodable, Sendable {
    public let error: String
}

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

    latr.post("saves") { request, _ in
        await handleProtected(request: request, services: services) { auth in
            let body = try await decodeJSONBody(request, as: SaveBody.self)
            let library = services.savedLibrary(for: auth)

            switch body {
            case let .url(url):
                let ogFields = await fetchOpenGraphMetadata(url: url, httpClient: services.httpClient)
                let preview = ogFields.map(openGraphPreview(from:))
                try await library.save(url: url, preview: preview)
                return try jsonResponse(SaveOKResponse(ok: true, kind: "url"), status: .created)
            case let .subject(subjectURI, linkedWebURL):
                let linked = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines)
                let preview: OpenGraphPreview?
                if let linked, !linked.isEmpty,
                   let ogFields = await fetchOpenGraphMetadata(url: linked, httpClient: services.httpClient)
                {
                    preview = openGraphPreview(from: ogFields)
                } else {
                    preview = nil
                }
                try await library.save(
                    subjectURI: subjectURI,
                    linkedWebURL: linkedWebURL,
                    preview: preview
                )
                return try jsonResponse(SaveOKResponse(ok: true, kind: "subject"), status: .created)
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
            let result = await discoverAtURIFromURL(raw, httpClient: services.httpClient)
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

            if let og = await fetchOpenGraphMetadata(url: parsed.absoluteString, httpClient: services.httpClient) {
                return try jsonResponse(og)
            }
            return try jsonResponse(OGPreviewFailureResponse(error: "fetch_failed"), status: .badGateway)
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

private func handleProtected(
    request: Request,
    services: GatewayServices,
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try await authenticateRequest(
            request,
            config: services.config,
            store: services.developerStore
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
