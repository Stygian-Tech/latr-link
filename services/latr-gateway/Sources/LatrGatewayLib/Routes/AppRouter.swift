import AsyncHTTPClient
import Foundation
import Hummingbird

public struct GatewayServices: Sendable {
    public let config: GatewayConfig
    public let httpClient: HTTPClient

    public init(config: GatewayConfig, httpClient: HTTPClient) {
        self.config = config
        self.httpClient = httpClient
    }

    public func pdsClient(auth: AuthContext) -> PDSRepoClient {
        PDSRepoClient(auth: auth, plcURL: config.plcURL, httpClient: httpClient)
    }
}

public struct HealthResponse: Encodable, Sendable {
    public let status: String
    public let service: String
}

public struct AuthProbeResponse: Encodable, Sendable {
    public let ok: Bool
    public let did: String
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
    public let records: [RepoRecord<SavedItemRecord>]
}

public struct SavedItemLookupResponse: Encodable, Sendable {
    public let record: RepoRecord<SavedItemRecord>?
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

    let latr = router.group("v1/latr")

    latr.post("auth/probe") { request, _ in
        try await handleProtected(request: request, services: services) { auth in
            let client = services.pdsClient(auth: auth)
            let page = try await client.listRecords(
                repo: auth.did,
                collection: Collection.savedItem,
                limit: 1,
                cursor: nil
            ) as ListRecordsPage<SavedItemRecord>

            return try jsonResponse(
                AuthProbeResponse(
                    ok: true,
                    did: auth.did,
                    pdsWriteThrough: true,
                    sampleCount: page.records.count,
                    upstreamDpop: auth.upstreamDpopProof != nil
                )
            )
        }
    }

    latr.get("saves") { request, _ in
        try await handleProtected(request: request, services: services) { auth in
            let client = services.pdsClient(auth: auth)
            let items = try await listSavedItems(client: client, did: auth.did)
            return try jsonResponse(SavedItemsResponse(records: items))
        }
    }

    latr.post("saves") { request, _ in
        try await handleProtected(request: request, services: services) { auth in
            let body = try await decodeJSONBody(request, as: SaveBody.self)
            let client = services.pdsClient(auth: auth)

            switch body {
            case let .url(url):
                let ogFields = await fetchOpenGraphMetadata(url: url, httpClient: services.httpClient)
                let og = ogFields.map(openGraphMetadata(from:))
                try await saveExternalURL(client: client, did: auth.did, url: url, og: og)
                return try jsonResponse(SaveOKResponse(ok: true, kind: "url"), status: .created)
            case let .subject(subjectURI, linkedWebURL):
                let linked = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines)
                let og: OpenGraphMetadata?
                if let linked, !linked.isEmpty,
                   let ogFields = await fetchOpenGraphMetadata(url: linked, httpClient: services.httpClient)
                {
                    og = openGraphMetadata(from: ogFields)
                } else {
                    og = nil
                }
                try await saveSubjectURI(
                    client: client,
                    did: auth.did,
                    subjectURI: subjectURI,
                    linkedWebURL: linkedWebURL,
                    og: og
                )
                return try jsonResponse(SaveOKResponse(ok: true, kind: "subject"), status: .created)
            }
        }
    }

    latr.get("saves/subject") { request, _ in
        try await handleProtected(request: request, services: services) { auth in
            guard let subjectURI = request.uri.queryParameters.get("subjectUri")?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !subjectURI.isEmpty
            else {
                throw GatewayError(status: .badRequest, message: "missing subjectUri", code: "missing_subject")
            }

            let client = services.pdsClient(auth: auth)
            let rkey = rkeyFromSubjectURI(subjectURI)
            let record = try await getSavedItem(client: client, did: auth.did, rkey: rkey)
            return try jsonResponse(SavedItemLookupResponse(record: record))
        }
    }

    latr.patch("saves/:itemRkey/state") { request, context in
        try await handleProtected(request: request, services: services) { auth in
            let itemRkey = (try? context.parameters.require("itemRkey"))
                ?? request.uri.path.split(separator: "/").dropLast().last.map(String.init)
                ?? ""
            let decodedRkey = itemRkey.removingPercentEncoding ?? itemRkey
            guard !decodedRkey.isEmpty else {
                throw GatewayError(status: .notFound, message: "Not found", code: "not_found")
            }
            let body = try await decodeJSONBody(request, as: StatePatchBody.self)
            let client = services.pdsClient(auth: auth)
            do {
                try await setSavedItemState(
                    client: client,
                    did: auth.did,
                    itemRkey: decodedRkey,
                    state: body.state
                )
            } catch RecordsError.savedItemNotFound {
                throw GatewayError(status: .notFound, message: "Saved item not found", code: "not_found")
            }
            return try jsonResponse(SimpleOKResponse(ok: true))
        }
    }

    latr.delete("saves/:itemRkey") { request, context in
        try await handleProtected(request: request, services: services) { auth in
            let itemRkey = (try? context.parameters.require("itemRkey"))
                ?? request.uri.path.split(separator: "/").last.map(String.init)
                ?? ""
            let decodedRkey = itemRkey.removingPercentEncoding ?? itemRkey
            guard !decodedRkey.isEmpty else {
                throw GatewayError(status: .notFound, message: "Not found", code: "not_found")
            }
            let client = services.pdsClient(auth: auth)
            try await deleteSavedItem(client: client, did: auth.did, itemRkey: decodedRkey)
            return try jsonResponse(SimpleOKResponse(ok: true))
        }
    }

    latr.get("discover/at-uri") { request, _ in
        try await handleProtected(request: request, services: services) { _ in
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
        try await handleProtected(request: request, services: services) { _ in
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

private func handleProtected(
    request: Request,
    services: GatewayServices,
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try authenticateRequest(request, config: services.config)
        return try await handler(auth)
    } catch {
        return errorResponse(error)
    }
}
