import Foundation
import Hummingbird
import HTTPTypes

public struct AuthContext: Sendable {
    public let did: String
    public let authorizationHeader: String
    public let dpopProof: String
    public let upstreamDpopProof: String?
    /// Resolved official client id when `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` is enabled.
    public let clientID: String?

    public init(
        did: String,
        authorizationHeader: String,
        dpopProof: String,
        upstreamDpopProof: String? = nil,
        clientID: String? = nil
    ) {
        self.did = did
        self.authorizationHeader = authorizationHeader
        self.dpopProof = dpopProof
        self.upstreamDpopProof = upstreamDpopProof
        self.clientID = clientID
    }
}

public let upstreamDPOPHeader = "X-ATProto-Upstream-DPoP"

public func extractAccessTokenJWT(from authorization: String) -> String? {
    let trimmed = authorization.trimmingCharacters(in: .whitespacesAndNewlines)
    let lower = trimmed.lowercased()
    if lower.hasPrefix("dpop ") {
        let rest = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines)
        return rest.isEmpty ? nil : rest
    }
    if lower.hasPrefix("bearer ") {
        let rest = String(trimmed.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
        return rest.isEmpty ? nil : rest
    }
    return nil
}

public func extractDPOPHeader(from headers: HTTPFields) -> String? {
    for name in ["DPoP", "Dpop", "dpop"] {
        guard let fieldName = HTTPField.Name(name) else { continue }
        if let value = headers[fieldName]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty
        {
            return value
        }
    }
    return nil
}

public func extractUpstreamDPOPHeader(from headers: HTTPFields) -> String? {
    guard let fieldName = HTTPField.Name(upstreamDPOPHeader) else { return nil }
    guard let value = headers[fieldName]?.trimmingCharacters(in: .whitespacesAndNewlines),
          !value.isEmpty
    else {
        return nil
    }
    return value
}

private func assertDPOPStructure(_ proof: String) throws {
    let parts = proof.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else {
        throw GatewayError(status: .unauthorized, message: "Invalid DPoP proof structure", code: "invalid_dpop")
    }
}

public func authenticateRequest(
    _ request: Request,
    config: GatewayConfig,
    store: any DeveloperStore,
    requireClientAPIKey override: Bool? = nil
) async throws -> AuthContext {
    let requireClientAPIKey = override ?? config.requireClientAPIKey
    let requireGatewayClient =
        requireClientAPIKey || config.oauthRequireKnownClient
    let clientID = try await store.resolveClientID(
        from: request.headers,
        requireClientAPIKey: requireGatewayClient
    )

    guard let authorization = request.headers[.authorization]?
        .trimmingCharacters(in: .whitespacesAndNewlines),
        !authorization.isEmpty
    else {
        throw GatewayError(status: .unauthorized, message: "Missing Authorization header", code: "missing_auth")
    }

    guard let accessToken = extractAccessTokenJWT(from: authorization) else {
        throw GatewayError(
            status: .unauthorized,
            message: "Authorization header must prefix DPoP or Bearer",
            code: "invalid_auth_scheme"
        )
    }

    guard let dpop = extractDPOPHeader(from: request.headers) else {
        throw GatewayError(status: .unauthorized, message: "Missing DPoP proof header", code: "missing_dpop")
    }
    try assertDPOPStructure(dpop)

    let payload = try decodeJWTPayload(accessToken)
    guard let did = payload.sub?.trimmingCharacters(in: .whitespacesAndNewlines), did.hasPrefix("did:") else {
        throw GatewayError(status: .unauthorized, message: "Access token sub must be a DID", code: "invalid_sub")
    }

    let now = Int(Date().timeIntervalSince1970)
    if let exp = payload.exp, exp < now {
        throw GatewayError(status: .unauthorized, message: "Access token expired", code: "token_expired")
    }

    try assertKnownClient(config: config, resolvedClientID: clientID)

    let upstream = extractUpstreamDPOPHeader(from: request.headers)
    if let upstream {
        for proof in upstream.split(separator: ",") {
            let trimmed = proof.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            try assertDPOPStructure(trimmed)
        }
    }

    return AuthContext(
        did: did,
        authorizationHeader: authorization,
        dpopProof: dpop,
        upstreamDpopProof: upstream,
        clientID: clientID
    )
}

#if DEBUG
public func testAuthContext(did: String) -> AuthContext {
    AuthContext(
        did: did,
        authorizationHeader: "DPoP test-token",
        dpopProof: "test.dpop.jwt"
    )
}
#endif
