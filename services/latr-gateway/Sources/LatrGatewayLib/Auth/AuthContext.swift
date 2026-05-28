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

private struct JWTPayload: Decodable {
    let sub: String?
    let exp: Int?
    let client_id: String?
    let azp: String?
    let aud: Audience?

    enum Audience: Decodable {
        case single(String)
        case multiple([String])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if let array = try? container.decode([String].self) {
                self = .multiple(array)
            } else {
                self = .single(try container.decode(String.self))
            }
        }

        var values: [String] {
            switch self {
            case let .single(value): [value]
            case let .multiple(values): values
            }
        }
    }
}

private func decodeJWTPayload(_ token: String) throws -> JWTPayload {
    let parts = token.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count >= 2 else {
        throw GatewayError(status: .unauthorized, message: "Malformed access token", code: "invalid_token")
    }

    var payloadB64 = String(parts[1])
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let padding = (4 - payloadB64.count % 4) % 4
    payloadB64.append(String(repeating: "=", count: padding))

    guard let data = Data(base64Encoded: payloadB64) else {
        throw GatewayError(
            status: .unauthorized,
            message: "Malformed access token payload",
            code: "invalid_token"
        )
    }

    do {
        return try JSONDecoder().decode(JWTPayload.self, from: data)
    } catch {
        throw GatewayError(
            status: .unauthorized,
            message: "Malformed access token payload",
            code: "invalid_token"
        )
    }
}

private func assertKnownClient(config: GatewayConfig, payload: JWTPayload) throws {
    guard config.oauthRequireKnownClient else { return }

    if config.oauthAllowedClientIDs.isEmpty {
        throw GatewayError(
            status: .forbidden,
            message: "Gateway client policy enabled but no allowlist configured",
            code: "client_policy"
        )
    }

    var candidates: [String] = []
    if let clientID = payload.client_id { candidates.append(clientID) }
    if let azp = payload.azp { candidates.append(azp) }
    if candidates.contains(where: { config.oauthAllowedClientIDs.contains($0) }) {
        return
    }

    if let aud = payload.aud?.values,
       aud.contains(where: { config.oauthAllowedClientIDs.contains($0) })
    {
        return
    }

    throw GatewayError(
        status: .forbidden,
        message: "OAuth client is not authorized for this gateway",
        code: "client_forbidden"
    )
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
    registry: ClientRegistry
) async throws -> AuthContext {
    let clientID = try await registry.resolveClientID(
        from: request.headers,
        requireClientAPIKey: config.requireClientAPIKey
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

    try assertKnownClient(config: config, payload: payload)

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
