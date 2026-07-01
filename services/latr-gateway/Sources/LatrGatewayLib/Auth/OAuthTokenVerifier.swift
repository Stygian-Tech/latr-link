import AsyncHTTPClient
import Crypto
import Foundation

private struct OAuthTokenHeader: Decodable {
    let alg: String
    let kid: String?
}

private struct OAuthAuthorizationServerMetadata: Decodable {
    let issuer: String?
    let jwks_uri: String
}

private struct JWKSet: Decodable {
    let keys: [OAuthJWK]
}

private struct OAuthJWK: Decodable {
    let kty: String
    let kid: String?
    let crv: String?
    let x: String?
    let y: String?
    let n: String?
    let e: String?
}

struct VerifiedOAuthToken: Sendable {
    let payload: JWTPayload
}

public struct OAuthTokenVerifier: Sendable {
    private let httpClient: HTTPClient
    private let fetchData: (@Sendable (URL) async throws -> Data)?

    public init(
        httpClient: HTTPClient,
        fetchData: (@Sendable (URL) async throws -> Data)? = nil
    ) {
        self.httpClient = httpClient
        self.fetchData = fetchData
    }

    func verify(accessToken: String, dpopJWK: DPoPJWK) async throws -> VerifiedOAuthToken {
        let header = try decodeJWTHeader(accessToken)
        let payload = try decodeJWTPayload(accessToken)
        guard let issuer = payload.iss?.trimmingCharacters(in: .whitespacesAndNewlines),
              let issuerURL = URL(string: issuer),
              issuerURL.scheme == "https",
              issuerURL.host?.isEmpty == false
        else {
            throw GatewayError(status: .unauthorized, message: "Missing token issuer", code: "invalid_token")
        }

        let metadata = try await fetchAuthorizationServerMetadata(issuerURL: issuerURL)
        if let metadataIssuer = metadata.issuer, metadataIssuer != issuer {
            throw GatewayError(status: .unauthorized, message: "Token issuer metadata mismatch", code: "invalid_token")
        }
        let jwks = try await fetchJWKSet(jwksURI: metadata.jwks_uri)
        guard let key = jwks.keys.first(where: { jwk in
            guard jwk.kty == keyType(for: header.alg) else { return false }
            guard let kid = header.kid else { return true }
            return jwk.kid == kid
        }) else {
            throw GatewayError(status: .unauthorized, message: "Token signing key not found", code: "invalid_token")
        }

        guard try verifyJWTSignature(jwt: accessToken, header: header, key: key) else {
            throw GatewayError(status: .unauthorized, message: "Invalid token signature", code: "invalid_token")
        }

        if let cnf = payload.cnf, let jkt = cnf.jkt {
            guard try jkt == jwkThumbprint(dpopJWK) else {
                throw GatewayError(status: .unauthorized, message: "Token DPoP key mismatch", code: "invalid_token")
            }
        } else {
            throw GatewayError(status: .unauthorized, message: "Token missing DPoP confirmation", code: "invalid_token")
        }

        return VerifiedOAuthToken(payload: payload)
    }

    private func decodeJWTHeader(_ token: String) throws -> OAuthTokenHeader {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let data = base64URLDecode(String(parts[0]))
        else {
            throw GatewayError(status: .unauthorized, message: "Malformed access token", code: "invalid_token")
        }
        do {
            return try JSONDecoder().decode(OAuthTokenHeader.self, from: data)
        } catch {
            throw GatewayError(status: .unauthorized, message: "Malformed access token header", code: "invalid_token")
        }
    }

    private func fetchAuthorizationServerMetadata(issuerURL: URL) async throws -> OAuthAuthorizationServerMetadata {
        let metadataURL = issuerURL.appendingPathComponent(".well-known/oauth-authorization-server")
        let data = try await fetch(metadataURL)
        return try JSONDecoder().decode(OAuthAuthorizationServerMetadata.self, from: data)
    }

    private func fetchJWKSet(jwksURI: String) async throws -> JWKSet {
        guard let url = URL(string: jwksURI), url.scheme == "https", url.host?.isEmpty == false else {
            throw GatewayError(status: .unauthorized, message: "Invalid token JWKS URI", code: "invalid_token")
        }
        let data = try await fetch(url)
        return try JSONDecoder().decode(JWKSet.self, from: data)
    }

    private func fetch(_ url: URL) async throws -> Data {
        if let fetchData {
            return try await fetchData(url)
        }
        var request = HTTPClientRequest(url: url.absoluteString)
        request.headers.add(name: "Accept", value: "application/json")
        let response = try await httpClient.execute(request, timeout: .seconds(10))
        guard response.status == .ok else {
            throw GatewayError(status: .unauthorized, message: "Token metadata lookup failed", code: "invalid_token")
        }
        let body = try await response.body.collect(upTo: 1_048_576)
        return Data(buffer: body)
    }

    private func verifyJWTSignature(jwt: String, header: OAuthTokenHeader, key: OAuthJWK) throws -> Bool {
        let signingInput = try jwtSigningInput(jwt)
        let signature = try jwtSignature(jwt)
        switch header.alg {
        case "ES256":
            guard key.crv == "P-256",
                  let x = key.x.flatMap(base64URLDecode),
                  let y = key.y.flatMap(base64URLDecode),
                  x.count == 32,
                  y.count == 32
            else {
                return false
            }
            let publicKey = try P256.Signing.PublicKey(x963Representation: Data([0x04]) + x + y)
            let ecdsa = try P256.Signing.ECDSASignature(rawRepresentation: signature)
            return publicKey.isValidSignature(ecdsa, for: signingInput)
        default:
            return false
        }
    }

    private func keyType(for alg: String) -> String {
        switch alg {
        case "ES256": "EC"
        default: ""
        }
    }
}
