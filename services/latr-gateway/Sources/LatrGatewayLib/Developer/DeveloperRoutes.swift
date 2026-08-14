import AsyncHTTPClient
import Foundation
import Hummingbird

public enum DeveloperRoutes {
    public static func register(on latr: RouterGroup<BasicRequestContext>, services: GatewayServices) {
        let developer = latr.group("developer")

        developer.get("clients") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                try jsonResponse(try await DeveloperOperations.listClients(auth: auth, services: services))
            }
        }

        developer.post("clients") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                let body = try await decodeJSONBody(request, as: CreateDeveloperClientBody.self)
                return try jsonResponse(
                    try await DeveloperOperations.createClient(
                        clientID: body.clientId,
                        displayName: body.displayName,
                        auth: auth,
                        services: services
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
                return try jsonResponse(
                    try await DeveloperOperations.deleteClient(
                        clientID: decoded,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        developer.get("clients/:clientId/keys") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId"))
                    ?? request.uri.path.split(separator: "/").dropLast().last.map(String.init)
                    ?? ""
                let decoded = clientId.removingPercentEncoding ?? clientId
                return try jsonResponse(
                    try await DeveloperOperations.listKeys(
                        clientID: decoded,
                        auth: auth,
                        services: services
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
                return try jsonResponse(
                    try await DeveloperOperations.createKey(
                        clientID: decoded,
                        label: body.label,
                        auth: auth,
                        services: services
                    ),
                    status: .created
                )
            }
        }

        developer.delete("clients/:clientId/keys/:keyId") { request, context in
            await handleDeveloper(request: request, services: services) { auth in
                let clientId = (try? context.parameters.require("clientId")) ?? ""
                let keyId = (try? context.parameters.require("keyId")) ?? ""
                return try jsonResponse(
                    try await DeveloperOperations.revokeKey(
                        clientID: clientId.removingPercentEncoding ?? clientId,
                        keyID: keyId.removingPercentEncoding ?? keyId,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        developer.get("usage") { request, _ in
            await handleDeveloper(request: request, services: services) { auth in
                try jsonResponse(try await DeveloperOperations.getUsage(auth: auth, services: services))
            }
        }
    }
}

func handleDeveloper(
    request: Request,
    services: GatewayServices,
    errorResponder: @Sendable (Error) -> Response = errorResponse,
    handler: (AuthContext) async throws -> Response
) async -> Response {
    do {
        let auth = try await authenticateDeveloperRequest(
            request,
            config: services.config,
            store: services.developerStore,
            httpClient: services.httpClient
        )
        try await attestDeveloperOAuthSessionIfNeeded(auth: auth) {
            try await services.repositoryClient(for: auth).attestOAuthSession()
        }
        return try await handler(auth)
    } catch {
        return errorResponder(error)
    }
}

func attestDeveloperOAuthSessionIfNeeded(
    auth: AuthContext,
    attest: @Sendable () async throws -> Void
) async throws {
    guard !auth.accessTokenSignatureVerified else { return }
    try await attest()
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
