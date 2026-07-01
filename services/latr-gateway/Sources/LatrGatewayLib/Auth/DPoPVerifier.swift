import Crypto
import Foundation
import Hummingbird
import HTTPTypes

struct DPoPJWK: Decodable, Encodable {
    let kty: String
    let crv: String
    let x: String
    let y: String
}

private struct DPoPHeader: Decodable {
    let typ: String?
    let alg: String
    let jwk: DPoPJWK
}

private struct DPoPPayload: Decodable {
    let htm: String
    let htu: String
    let iat: Int
    let jti: String
    let ath: String?
}

private final class DPoPReplayCache: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [String: Int] = [:]

    func insert(_ jti: String, expiresAt: Int, now: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        seen = seen.filter { $0.value >= now }
        guard seen[jti] == nil else { return false }
        seen[jti] = expiresAt
        return true
    }
}

private let dpopReplayCache = DPoPReplayCache()

func verifyGatewayDPoP(
    proof: String,
    accessToken: String,
    request: Request,
    now: Date = Date()
) throws -> DPoPJWK {
    let headerData = try jwtSegmentData(proof, segment: 0, code: "invalid_dpop")
    let payloadData = try jwtSegmentData(proof, segment: 1, code: "invalid_dpop")
    let header = try decodeDPoP(DPoPHeader.self, from: headerData)
    let payload = try decodeDPoP(DPoPPayload.self, from: payloadData)

    guard header.typ?.caseInsensitiveCompare("dpop+jwt") == .orderedSame else {
        throw GatewayError(status: .unauthorized, message: "Invalid DPoP proof type", code: "invalid_dpop")
    }
    guard header.alg == "ES256", header.jwk.kty == "EC", header.jwk.crv == "P-256" else {
        throw GatewayError(status: .unauthorized, message: "Unsupported DPoP key", code: "invalid_dpop")
    }

    guard payload.htm.uppercased() == request.method.rawValue.uppercased() else {
        throw GatewayError(status: .unauthorized, message: "DPoP method mismatch", code: "invalid_dpop")
    }
    guard normalizeDPoPURL(payload.htu) == normalizeDPoPURL(gatewayRequestURL(request)) else {
        throw GatewayError(status: .unauthorized, message: "DPoP URL mismatch", code: "invalid_dpop")
    }

    let nowSeconds = Int(now.timeIntervalSince1970)
    guard abs(nowSeconds - payload.iat) <= 300 else {
        throw GatewayError(status: .unauthorized, message: "DPoP proof expired", code: "invalid_dpop")
    }
    guard !payload.jti.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          dpopReplayCache.insert(payload.jti, expiresAt: payload.iat + 300, now: nowSeconds)
    else {
        throw GatewayError(status: .unauthorized, message: "DPoP proof replayed", code: "invalid_dpop_replay")
    }

    let expectedAth = base64URLEncode(Data(SHA256.hash(data: Data(accessToken.utf8))))
    guard payload.ath == expectedAth else {
        throw GatewayError(status: .unauthorized, message: "DPoP access token hash mismatch", code: "invalid_dpop")
    }

    let publicKey = try publicKey(from: header.jwk)
    let signature = try P256.Signing.ECDSASignature(rawRepresentation: jwtSignature(proof))
    guard publicKey.isValidSignature(signature, for: try jwtSigningInput(proof)) else {
        throw GatewayError(status: .unauthorized, message: "Invalid DPoP signature", code: "invalid_dpop")
    }

    return header.jwk
}

func jwkThumbprint(_ jwk: DPoPJWK) throws -> String {
    let canonical = #"{"crv":"\#(jwk.crv)","kty":"\#(jwk.kty)","x":"\#(jwk.x)","y":"\#(jwk.y)"}"#
    return base64URLEncode(Data(SHA256.hash(data: Data(canonical.utf8))))
}

private func publicKey(from jwk: DPoPJWK) throws -> P256.Signing.PublicKey {
    guard let x = base64URLDecode(jwk.x), let y = base64URLDecode(jwk.y), x.count == 32, y.count == 32 else {
        throw GatewayError(status: .unauthorized, message: "Invalid DPoP public key", code: "invalid_dpop")
    }
    return try P256.Signing.PublicKey(x963Representation: Data([0x04]) + x + y)
}

private func jwtSegmentData(_ jwt: String, segment: Int, code: String) throws -> Data {
    let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, parts.indices.contains(segment), let data = base64URLDecode(String(parts[segment])) else {
        throw GatewayError(status: .unauthorized, message: "Malformed DPoP proof", code: code)
    }
    return data
}

private func decodeDPoP<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
    do {
        return try JSONDecoder().decode(T.self, from: data)
    } catch {
        throw GatewayError(status: .unauthorized, message: "Malformed DPoP proof", code: "invalid_dpop")
    }
}

private func gatewayRequestURL(_ request: Request) -> String {
    if request.uri.description.hasPrefix("http://") || request.uri.description.hasPrefix("https://") {
        return request.uri.description
    }
    let scheme = request.head.scheme ?? "http"
    let authority = request.head.authority ?? "localhost"
    return "\(scheme)://\(authority)\(request.uri)"
}

private func normalizeDPoPURL(_ raw: String) -> String? {
    guard var components = URLComponents(string: raw),
          let scheme = components.scheme?.lowercased(),
          let host = components.host?.lowercased()
    else {
        return nil
    }
    components.scheme = scheme
    components.host = host
    components.fragment = nil
    if (scheme == "https" && components.port == 443) || (scheme == "http" && components.port == 80) {
        components.port = nil
    }
    return components.url?.absoluteString
}
