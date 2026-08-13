import Foundation
import Hummingbird

public struct GatewayError: Error, Sendable {
    public let status: HTTPResponse.Status
    public let message: String
    public let code: String

    public init(status: HTTPResponse.Status, message: String, code: String) {
        self.status = status
        self.message = message
        self.code = code
    }
}

public func jsonResponse<T: Encodable>(
    _ body: T,
    status: HTTPResponse.Status = .ok
) throws -> Response {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(body)
    var buffer = ByteBuffer()
    buffer.writeBytes(data)
    var headers = HTTPFields()
    headers[.contentType] = "application/json; charset=utf-8"
    return Response(status: status, headers: headers, body: .init(byteBuffer: buffer))
}

public func errorResponse(_ error: Error) -> Response {
    if let gatewayError = error as? GatewayError {
        return (try? jsonResponse(
            ErrorBody(error: gatewayError.code, message: gatewayError.message),
            status: gatewayError.status
        )) ?? Response(status: gatewayError.status)
    }
    if error is DecodingError {
        print("Decode error: \(error)")
        return (try? jsonResponse(
            ErrorBody(error: "decode_error", message: "Response could not be decoded"),
            status: .badGateway
        )) ?? Response(status: .badGateway)
    }
    print("Internal error: \(error)")
    return (try? jsonResponse(
        ErrorBody(error: "internal_error", message: "Internal server error"),
        status: .internalServerError
    )) ?? Response(status: .internalServerError)
}

/// XRPC-compatible response encoder. Authenticated gateway queries are intentionally
/// non-cacheable even though XRPC queries use GET.
public func xrpcJSONResponse<T: Encodable>(_ body: T) throws -> Response {
    var response = try jsonResponse(body)
    response.headers[.cacheControl] = "private, no-store"
    return response
}

public func xrpcErrorResponse(_ error: Error) -> Response {
    let gatewayError: GatewayError
    if let typed = error as? GatewayError {
        gatewayError = typed
    } else if error is DecodingError {
        gatewayError = GatewayError(
            status: .badRequest,
            message: "Invalid JSON input",
            code: "invalid_request"
        )
    } else {
        gatewayError = GatewayError(
            status: .internalServerError,
            message: "Internal server error",
            code: "internal_error"
        )
    }

    let xrpcName: String = switch gatewayError.code {
    case "missing_auth": "AuthRequired"
    case "invalid_auth_scheme", "invalid_token", "invalid_sub", "token_expired", "unsupported_token_alg":
        "InvalidToken"
    case "missing_dpop", "invalid_dpop", "invalid_dpop_replay": "InvalidDpop"
    case "missing_client_credential", "missing_client_id": "ClientAuthRequired"
    case "invalid_client_credential", "invalid_client_id", "unknown_client": "InvalidClient"
    case "saved_item_not_found", "not_found": "SavedItemNotFound"
    case "invalid_url", "missing_url": "InvalidUrl"
    case "usage_limit_exceeded": "RateLimitExceeded"
    case "pds_error", "pds_resolve", "pds_record_decode", "database_error": "UpstreamFailure"
    case "pds_unauthorized", "invalid_upstream_dpop", "missing_upstream_dpop": "InvalidDpop"
    case "pds_forbidden", "forbidden", "client_forbidden": "Forbidden"
    case "conflict": "Conflict"
    case "client_exists": "ClientExists"
    case "client_not_found": "ClientNotFound"
    case "key_not_found": "KeyNotFound"
    default: "InvalidRequest"
    }

    var response = (try? jsonResponse(
        ErrorBody(error: xrpcName, message: gatewayError.message),
        status: gatewayError.status
    )) ?? Response(status: gatewayError.status)
    response.headers[.cacheControl] = "private, no-store"
    if gatewayError.status == .unauthorized {
        response.headers[.wwwAuthenticate] = "DPoP"
    }
    return response
}

public func decodeJSONBody<T: Decodable>(_ request: Request, as type: T.Type) async throws -> T {
    do {
        let buffer = try await request.body.collect(upTo: 1_048_576)
        let data = Data(buffer: buffer)
        return try JSONDecoder().decode(T.self, from: data)
    } catch let gatewayError as GatewayError {
        throw gatewayError
    } catch {
        throw GatewayError(status: .badRequest, message: "Invalid JSON body", code: "invalid_json")
    }
}
