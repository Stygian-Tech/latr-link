import Foundation
import Hummingbird
import HTTPTypes
import AsyncHTTPClient

public struct AuthContext: Sendable {
    public let did: String
    public let authorizationHeader: String
    public let dpopProof: String
    public let upstreamDpopProof: String?
    /// Resolved official client id when `LATR_GATEWAY_REQUIRE_CLIENT_API_KEY` is enabled.
    public let clientID: String?
    public let accessTokenSignatureVerified: Bool

    public init(
        did: String,
        authorizationHeader: String,
        dpopProof: String,
        upstreamDpopProof: String? = nil,
        clientID: String? = nil,
        accessTokenSignatureVerified: Bool = true
    ) {
        self.did = did
        self.authorizationHeader = authorizationHeader
        self.dpopProof = dpopProof
        self.upstreamDpopProof = upstreamDpopProof
        self.clientID = clientID
        self.accessTokenSignatureVerified = accessTokenSignatureVerified
    }
}

public let upstreamDPOPHeader = "X-ATProto-Upstream-DPoP"
public let forwardedAuthorizationHeader = "X-Latr-Forwarded-Authorization"
public let forwardedDPOPHeader = "X-Latr-Forwarded-DPoP"

private func headerValue(from headers: HTTPFields, names: [String]) -> String? {
    for name in names {
        guard let fieldName = HTTPField.Name(name) else { continue }
        if let value = headers[fieldName]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty
        {
            return value
        }
    }
    return nil
}

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
    headerValue(
        from: headers,
        names: ["DPoP", "Dpop", "dpop", forwardedDPOPHeader, forwardedDPOPHeader.lowercased()]
    )
}

public func extractAuthorizationHeader(from headers: HTTPFields) -> String? {
    headerValue(
        from: headers,
        names: ["Authorization", "authorization", forwardedAuthorizationHeader, forwardedAuthorizationHeader.lowercased()]
    )
}

public func extractUpstreamDPOPHeader(from headers: HTTPFields) -> String? {
    headerValue(from: headers, names: [upstreamDPOPHeader, upstreamDPOPHeader.lowercased()])
}

private func assertDPOPStructure(_ proof: String) throws {
    let parts = proof.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else {
        throw GatewayError(status: .unauthorized, message: "Invalid DPoP proof structure", code: "invalid_dpop")
    }
}

/// Whether this request must present registered gateway client credentials.
/// Developer management routes pass `requireClientAPIKey: false` and must not inherit
/// `OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT` (OAuth + DPoP only per product docs).
public func resolvesRegisteredClientRequirement(
    requireClientAPIKey override: Bool?,
    config: GatewayConfig
) -> Bool {
    if let override {
        return override
    }
    return config.requireClientAPIKey || config.oauthRequireKnownClient
}

public func authenticateRequest(
    _ request: Request,
    config: GatewayConfig,
    store: any DeveloperStore,
    httpClient: HTTPClient? = nil,
    requireClientAPIKey override: Bool? = nil,
    upstreamDpopProof upstreamOverride: String? = nil
) async throws -> AuthContext {
    let requireRegisteredClient = resolvesRegisteredClientRequirement(
        requireClientAPIKey: override,
        config: config
    )
    let clientID = try await store.resolveClientID(
        from: request.headers,
        requireClientAPIKey: requireRegisteredClient
    )

    guard let authorization = extractAuthorizationHeader(from: request.headers) else {
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
    let dpopJWK = try verifyGatewayDPoP(proof: dpop, accessToken: accessToken, request: request)

    let payload: JWTPayload
    let accessTokenSignatureVerified: Bool
    if let httpClient {
        let verified = try await OAuthTokenVerifier(httpClient: httpClient)
            .verify(accessToken: accessToken, dpopJWK: dpopJWK)
        payload = verified.payload
        accessTokenSignatureVerified = verified.signatureVerified
    } else {
        payload = try decodeJWTPayload(accessToken)
        accessTokenSignatureVerified = false
        if let jkt = payload.cnf?.jkt {
            guard try jkt == jwkThumbprint(dpopJWK) else {
                throw GatewayError(status: .unauthorized, message: "Token DPoP key mismatch", code: "invalid_token")
            }
        } else {
            throw GatewayError(status: .unauthorized, message: "Token missing DPoP confirmation", code: "invalid_token")
        }
    }

    guard let did = payload.sub?.trimmingCharacters(in: .whitespacesAndNewlines), did.hasPrefix("did:") else {
        throw GatewayError(status: .unauthorized, message: "Access token sub must be a DID", code: "invalid_sub")
    }

    let now = Int(Date().timeIntervalSince1970)
    if let exp = payload.exp, exp < now {
        throw GatewayError(status: .unauthorized, message: "Access token expired", code: "token_expired")
    }

    try assertKnownClient(
        requireRegisteredClient: requireRegisteredClient,
        resolvedClientID: clientID
    )

    let upstream = upstreamOverride?.trimmingCharacters(in: .whitespacesAndNewlines)
        ?? extractUpstreamDPOPHeader(from: request.headers)
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
        clientID: clientID,
        accessTokenSignatureVerified: accessTokenSignatureVerified
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
