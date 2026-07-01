import Foundation

struct JWTPayload: Decodable {
    let sub: String?
    let iss: String?
    let exp: Int?
    let client_id: String?
    let azp: String?
    let aud: Audience?
    let cnf: Confirmation?

    struct Confirmation: Decodable {
        let jkt: String?
    }

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

func decodeJWTPayload(_ token: String) throws -> JWTPayload {
    let parts = token.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else {
        throw GatewayError(status: .unauthorized, message: "Malformed access token", code: "invalid_token")
    }

    guard let data = base64URLDecode(String(parts[1])) else {
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

public func assertKnownClient(
    requireRegisteredClient: Bool,
    resolvedClientID: String?
) throws {
    guard requireRegisteredClient else { return }

    guard resolvedClientID != nil else {
        throw GatewayError(
            status: .forbidden,
            message: "Registered gateway client credentials are required",
            code: "client_forbidden"
        )
    }
}
