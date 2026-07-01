import AsyncHTTPClient
import Foundation
import Hummingbird

public enum DeveloperRoutes {
    public static func register(on latr: RouterGroup<BasicRequestContext>, services: GatewayServices) {
        let developer = latr.group("developer")

        developer.get("clients") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                let records = try await services.developerStore.listClients(ownerDID: auth.did)
                let clients = records.map {
                    DeveloperClientSummaryResponse(
                        clientId: $0.clientID,
                        displayName: $0.displayName,
                        kind: "developer",
                        createdAt: $0.createdAt
                    )
                }
                return try jsonResponse(ListDeveloperClientsResponse(clients: clients))
            }
        }

        developer.post("clients") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                let body = try await decodeJSONBody(request, as: CreateDeveloperClientBody.self)
                let created = try await services.developerStore.createClient(
                    ownerDID: auth.did,
                    clientID: body.clientId,
                    displayName: body.displayName,
                    isOfficial: false
                )
                return try jsonResponse(
                    DeveloperClientSummaryResponse(
                        clientId: created.clientID,
                        displayName: created.displayName,
                        kind: "developer",
                        createdAt: created.createdAt
                    ),
                    status: .created
                )
            }
        }

        developer.delete("clients/:clientId") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId"))
                    ?? request.uri.path.split(separator: "/").last.map(String.init)
                    ?? ""
                let decoded = clientId.removingPercentEncoding ?? clientId
                try await services.developerStore.deleteClient(ownerDID: auth.did, clientID: decoded)
                return try jsonResponse(SimpleOKResponse(ok: true))
            }
        }

        developer.get("clients/:clientId/keys") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId"))
                    ?? request.uri.path.split(separator: "/").dropLast().last.map(String.init)
                    ?? ""
                let decoded = clientId.removingPercentEncoding ?? clientId
                let keys = try await services.developerStore.listApiKeys(ownerDID: auth.did, clientID: decoded)
                return try jsonResponse(
                    ListDeveloperApiKeysResponse(
                        keys: keys.map {
                            DeveloperApiKeySummaryResponse(
                                keyId: $0.keyID,
                                label: $0.label,
                                createdAt: $0.createdAt,
                                revokedAt: $0.revokedAt
                            )
                        }
                    )
                )
            }
        }

        developer.post("clients/:clientId/keys") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId"))
                    ?? request.uri.path.split(separator: "/").dropLast().last.map(String.init)
                    ?? ""
                let decoded = clientId.removingPercentEncoding ?? clientId
                let body = try await decodeJSONBody(request, as: CreateDeveloperApiKeyBody.self)
                let created = try await services.developerStore.createApiKey(
                    ownerDID: auth.did,
                    clientID: decoded,
                    label: body.label
                )
                return try jsonResponse(
                    CreateDeveloperApiKeyResponse(
                        keyId: created.record.keyID,
                        clientId: created.record.clientID,
                        apiKey: created.apiKey,
                        label: created.record.label,
                        createdAt: created.record.createdAt
                    ),
                    status: .created
                )
            }
        }

        developer.delete("clients/:clientId/keys/:keyId") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId")) ?? ""
                let keyId = (try? context.parameters.require("keyId")) ?? ""
                try await services.developerStore.revokeApiKey(
                    ownerDID: auth.did,
                    clientID: clientId.removingPercentEncoding ?? clientId,
                    keyID: keyId.removingPercentEncoding ?? keyId
                )
                return try jsonResponse(SimpleOKResponse(ok: true))
            }
        }

        developer.get("usage") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                let usage = try await services.developerStore.usageSummaries(ownerDID: auth.did)
                return try jsonResponse(ListDeveloperUsageResponse(usage: usage))
            }
        }
    }
}

private func handleDeveloper(
    request: Request,
    services: GatewayServices,
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try await authenticateDeveloperRequest(
            request,
            config: services.config,
            store: services.developerStore,
            httpClient: services.httpClient
        )
        return try await handler(auth)
    } catch {
        return errorResponse(error)
    }
}

private func authenticateDeveloperRequest(
    _ request: Request,
    config: GatewayConfig,
    store: any DeveloperStore,
    httpClient: HTTPClient
) async throws -> AuthContext {
    try await authenticateRequest(
        request,
        config: config,
        store: store,
        httpClient: httpClient,
        requireClientAPIKey: false
    )
}
