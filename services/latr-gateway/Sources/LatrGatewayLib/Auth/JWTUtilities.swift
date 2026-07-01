import Foundation

func base64URLDecode(_ value: String) -> Data? {
    var base64 = value
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let padding = (4 - base64.count % 4) % 4
    base64.append(String(repeating: "=", count: padding))
    return Data(base64Encoded: base64)
}

func base64URLEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func decodeJWTJSON(_ jwt: String, segment: Int) throws -> [String: Any] {
    let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, parts.indices.contains(segment) else {
        throw GatewayError(status: .unauthorized, message: "Malformed JWT", code: "invalid_token")
    }
    guard let data = base64URLDecode(String(parts[segment])),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        throw GatewayError(status: .unauthorized, message: "Malformed JWT payload", code: "invalid_token")
    }
    return json
}

func jwtSigningInput(_ jwt: String) throws -> Data {
    let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else {
        throw GatewayError(status: .unauthorized, message: "Malformed JWT", code: "invalid_token")
    }
    return Data("\(parts[0]).\(parts[1])".utf8)
}

func jwtSignature(_ jwt: String) throws -> Data {
    let parts = jwt.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3, let signature = base64URLDecode(String(parts[2])) else {
        throw GatewayError(status: .unauthorized, message: "Malformed JWT signature", code: "invalid_token")
    }
    return signature
}

func jwtClaimString(_ jwt: String, claim: String) -> String? {
    guard let json = try? decodeJWTJSON(jwt, segment: 1) else { return nil }
    return json[claim] as? String
}
