import Foundation
import Hummingbird
import LatrKit

public enum LatrXRPCRoutes {
    public static func register(
        on router: Router<BasicRequestContext>,
        services: GatewayServices
    ) {
        let xrpc = router.group("xrpc")

        xrpc.get(RouterPath(LatrXRPCMethod.listBookmarks.rawValue)) { request, _ in
            await handleProtected(request: request, services: services, errorResponder: xrpcErrorResponse) { auth in
                try validateQueryParameters(request, allowed: ["limit", "cursor"])
                let limit = try integerParameter(request, named: "limit", default: 50, range: 1 ... 100)
                return try xrpcJSONResponse(
                    try await BookmarkGatewayOperations.list(
                        auth: auth,
                        services: services,
                        limit: limit,
                        cursor: optionalParameter(request, named: "cursor")
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.getBookmark.rawValue)) { request, _ in
            await handleProtected(request: request, services: services, errorResponder: xrpcErrorResponse) { auth in
                try validateQueryParameters(request, allowed: ["subject"])
                return try xrpcJSONResponse(
                    try await BookmarkGatewayOperations.get(
                        subject: try requiredParameter(request, named: "subject"),
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.saveBookmark.rawValue)) { request, _ in
            await handleProtected(request: request, services: services, errorResponder: xrpcErrorResponse) { auth in
                let input = try await decodeXRPCInput(request, as: LatrSaveBookmarkInput.self)
                return try xrpcJSONResponse(
                    try await BookmarkGatewayOperations.save(input: input, auth: auth, services: services)
                )
            }
        }

        xrpc.patch(RouterPath(LatrXRPCMethod.setBookmarkState.rawValue)) { request, _ in
            await handleProtected(request: request, services: services, errorResponder: xrpcErrorResponse) { auth in
                let input = try await decodeXRPCInput(request, as: LatrSetBookmarkStateInput.self)
                return try xrpcJSONResponse(
                    try await BookmarkGatewayOperations.setState(input: input, auth: auth, services: services)
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.deleteBookmark.rawValue)) { request, _ in
            await handleProtected(request: request, services: services, errorResponder: xrpcErrorResponse) { auth in
                let input = try await decodeXRPCInput(request, as: LatrDeleteBookmarkInput.self)
                return try xrpcJSONResponse(
                    try await BookmarkGatewayOperations.delete(input: input, auth: auth, services: services)
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.migrateBookmarks.rawValue)) { request, _ in
            do {
                let body = try await decodeXRPCInput(request, as: MigrateBookmarksBody.self)
                return await handleProtected(
                    request: request,
                    services: services,
                    upstreamDpopProof: body.upstreamDpopProof,
                    errorResponder: xrpcErrorResponse
                ) { auth in
                    return try xrpcJSONResponse(
                        try await BookmarkGatewayOperations.migrate(
                            input: LatrMigrateBookmarksInput(limit: body.limit, cursor: body.cursor),
                            auth: auth,
                            services: services
                        )
                    )
                }
            } catch {
                return xrpcErrorResponse(error)
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.listItems.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: ["limit", "cursor"])
                let limit = try integerParameter(request, named: "limit", default: 100, range: 1 ... 100)
                let cursor = optionalParameter(request, named: "cursor")
                return try xrpcJSONResponse(
                    try await GatewayOperations.listItems(
                        auth: auth,
                        services: services,
                        limit: limit,
                        cursor: cursor
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.getItem.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: ["subjectUri"])
                return try xrpcJSONResponse(
                    try await GatewayOperations.getItem(
                        subjectURI: try requiredParameter(request, named: "subjectUri"),
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.saveURL.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: SaveURLInput.self)
                return try xrpcJSONResponse(
                    try await GatewayOperations.saveURL(input.url, auth: auth, services: services)
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.saveSubject.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: SaveSubjectInput.self)
                return try xrpcJSONResponse(
                    try await GatewayOperations.saveSubject(
                        subjectURI: input.subjectUri,
                        linkedWebURL: input.linkedWebUrl,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.setState.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: SetSavedItemStateInput.self)
                return try xrpcJSONResponse(
                    try await GatewayOperations.setState(
                        itemRkey: input.itemRkey,
                        state: input.state,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.deleteItem.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: DeleteSavedItemInput.self)
                return try xrpcJSONResponse(
                    try await GatewayOperations.deleteItem(
                        itemRkey: input.itemRkey,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.migrateLegacy.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                _ = try await decodeXRPCInput(request, as: EmptyXRPCInput.self)
                return try xrpcJSONResponse(
                    try await GatewayOperations.migrateLegacy(auth: auth, services: services)
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.getOpenGraph.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { _ in
                try validateQueryParameters(request, allowed: ["url"])
                return try xrpcJSONResponse(
                    try await GatewayOperations.openGraph(
                        try requiredParameter(request, named: "url"),
                        services: services
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.resolveURL.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { _ in
                try validateQueryParameters(request, allowed: ["url"])
                return try xrpcJSONResponse(
                    await GatewayOperations.resolveURL(
                        try requiredParameter(request, named: "url"),
                        services: services
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.authProbe.rawValue)) { request, _ in
            await handleProtected(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: [])
                return try xrpcJSONResponse(try await GatewayOperations.authProbe(auth: auth, services: services))
            }
        }

        registerDeveloperRoutes(on: xrpc, services: services)
        registerFallbackRoutes(on: xrpc)
    }

    private static func registerDeveloperRoutes(
        on xrpc: RouterGroup<BasicRequestContext>,
        services: GatewayServices
    ) {
        xrpc.get(RouterPath(LatrXRPCMethod.listDeveloperClients.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: [])
                return try xrpcJSONResponse(try await DeveloperOperations.listClients(auth: auth, services: services))
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.createDeveloperClient.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: CreateDeveloperClientBody.self)
                return try xrpcJSONResponse(
                    try await DeveloperOperations.createClient(
                        clientID: input.clientId,
                        displayName: input.displayName,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.deleteDeveloperClient.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: DeleteDeveloperClientInput.self)
                return try xrpcJSONResponse(
                    try await DeveloperOperations.deleteClient(
                        clientID: input.clientId,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.listDeveloperKeys.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: ["clientId"])
                return try xrpcJSONResponse(
                    try await DeveloperOperations.listKeys(
                        clientID: try requiredParameter(request, named: "clientId"),
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.createDeveloperKey.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: CreateDeveloperKeyInput.self)
                return try xrpcJSONResponse(
                    try await DeveloperOperations.createKey(
                        clientID: input.clientId,
                        label: input.label,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.post(RouterPath(LatrXRPCMethod.revokeDeveloperKey.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                let input = try await decodeXRPCInput(request, as: RevokeDeveloperKeyInput.self)
                return try xrpcJSONResponse(
                    try await DeveloperOperations.revokeKey(
                        clientID: input.clientId,
                        keyID: input.keyId,
                        auth: auth,
                        services: services
                    )
                )
            }
        }

        xrpc.get(RouterPath(LatrXRPCMethod.getDeveloperUsage.rawValue)) { request, _ in
            await handleDeveloper(
                request: request,
                services: services,
                errorResponder: xrpcErrorResponse
            ) { auth in
                try validateQueryParameters(request, allowed: [])
                return try xrpcJSONResponse(try await DeveloperOperations.getUsage(auth: auth, services: services))
            }
        }
    }

    private static func registerFallbackRoutes(on xrpc: RouterGroup<BasicRequestContext>) {
        // Hummingbird resolves a fixed path before a captured path, even when the
        // fixed node has no handler for the incoming verb. Register known wrong
        // verbs explicitly so XRPC callers always receive a JSON 405 response.
        for method in LatrXRPCMethod.allCases {
            let path = RouterPath(method.rawValue)
            switch method.kind {
            case .query:
                xrpc.post(path) { _, _ in knownMethodWrongVerbResponse() }
            case .procedure:
                xrpc.get(path) { _, _ in knownMethodWrongVerbResponse() }
            }
            xrpc.put(path) { _, _ in knownMethodWrongVerbResponse() }
            if method != .setBookmarkState {
                xrpc.patch(path) { _, _ in knownMethodWrongVerbResponse() }
            }
            xrpc.delete(path) { _, _ in knownMethodWrongVerbResponse() }
        }

        xrpc.get(":nsid") { request, context in
            fallbackResponse(request: request, context: context, expectedKind: .query)
        }
        xrpc.post(":nsid") { request, context in
            fallbackResponse(request: request, context: context, expectedKind: .procedure)
        }
        xrpc.put(":nsid") { request, context in
            methodNotAllowedResponse(request: request, context: context)
        }
        xrpc.patch(":nsid") { request, context in
            methodNotAllowedResponse(request: request, context: context)
        }
        xrpc.delete(":nsid") { request, context in
            methodNotAllowedResponse(request: request, context: context)
        }
    }
}

private func knownMethodWrongVerbResponse() -> Response {
    xrpcProtocolError(
        status: .methodNotAllowed,
        name: "InvalidRequest",
        message: "XRPC method was invoked with the wrong HTTP verb"
    )
}

private func requiredParameter(_ request: Request, named name: String) throws -> String {
    guard let value = optionalParameter(request, named: name) else {
        throw GatewayError(status: .badRequest, message: "\(name) is required", code: "invalid_request")
    }
    return value
}

private func optionalParameter(_ request: Request, named name: String) -> String? {
    guard let raw = request.uri.queryParameters.get(name)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !raw.isEmpty
    else { return nil }
    return raw
}

private func integerParameter(
    _ request: Request,
    named name: String,
    default defaultValue: Int,
    range: ClosedRange<Int>
) throws -> Int {
    guard let raw = optionalParameter(request, named: name) else { return defaultValue }
    guard let value = Int(raw), range.contains(value) else {
        throw GatewayError(
            status: .badRequest,
            message: "\(name) must be between \(range.lowerBound) and \(range.upperBound)",
            code: "invalid_request"
        )
    }
    return value
}

private func validateQueryParameters(_ request: Request, allowed: Set<String>) throws {
    var seen: Set<String> = []
    for (rawKey, _) in request.uri.queryParameters {
        let key = String(rawKey)
        guard allowed.contains(key), seen.insert(key).inserted else {
            throw GatewayError(
                status: .badRequest,
                message: allowed.contains(key)
                    ? "Query parameter \(key) must not be repeated"
                    : "Unknown query parameter: \(key)",
                code: "invalid_request"
            )
        }
    }
}

private func decodeXRPCInput<T: LatrXRPCInput>(_ request: Request, as type: T.Type) async throws -> T {
    let mediaType = request.headers[.contentType]?
        .split(separator: ";", maxSplits: 1)
        .first?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
    guard mediaType == "application/json" else {
        throw GatewayError(
            status: .badRequest,
            message: "Content-Type must be application/json",
            code: "invalid_request"
        )
    }
    do {
        let buffer = try await request.body.collect(upTo: 1_048_576)
        let data = Data(buffer: buffer)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayError(
                status: .badRequest,
                message: "XRPC input must be a JSON object",
                code: "invalid_request"
            )
        }
        let unknownKeys = Set(object.keys).subtracting(T.allowedKeys)
        guard unknownKeys.isEmpty else {
            throw GatewayError(
                status: .badRequest,
                message: "Unknown input property: \(unknownKeys.sorted().joined(separator: ", "))",
                code: "invalid_request"
            )
        }
        return try JSONDecoder().decode(T.self, from: data)
    } catch let error as GatewayError {
        throw error
    } catch {
        throw GatewayError(status: .badRequest, message: "Invalid JSON input", code: "invalid_request")
    }
}

private func fallbackResponse(
    request: Request,
    context: BasicRequestContext,
    expectedKind: LatrXRPCMethod.Kind
) -> Response {
    let raw = (try? context.parameters.require("nsid"))
        ?? request.uri.path.split(separator: "/").last.map(String.init)
        ?? ""
    guard let method = LatrXRPCMethod(rawValue: raw) else {
        return xrpcProtocolError(
            status: .notFound,
            name: "XrpcNotSupported",
            message: "XRPC method is not supported"
        )
    }
    guard method.kind == expectedKind else {
        return xrpcProtocolError(
            status: .methodNotAllowed,
            name: "InvalidRequest",
            message: "XRPC method was invoked with the wrong HTTP verb"
        )
    }
    return xrpcProtocolError(
        status: .notFound,
        name: "XrpcNotSupported",
        message: "XRPC method is not available"
    )
}

private func methodNotAllowedResponse(
    request: Request,
    context: BasicRequestContext
) -> Response {
    let raw = (try? context.parameters.require("nsid"))
        ?? request.uri.path.split(separator: "/").last.map(String.init)
        ?? ""
    return xrpcProtocolError(
        status: LatrXRPCMethod(rawValue: raw) == nil ? .notFound : .methodNotAllowed,
        name: LatrXRPCMethod(rawValue: raw) == nil ? "XrpcNotSupported" : "InvalidRequest",
        message: LatrXRPCMethod(rawValue: raw) == nil
            ? "XRPC method is not supported"
            : "XRPC method was invoked with the wrong HTTP verb"
    )
}

private func xrpcProtocolError(
    status: HTTPResponse.Status,
    name: String,
    message: String
) -> Response {
    var response = (try? jsonResponse(ErrorBody(error: name, message: message), status: status))
        ?? Response(status: status)
    response.headers[.cacheControl] = "private, no-store"
    return response
}
