import Foundation
import Hummingbird
import HTTPTypes
import LatrKit

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
    status: HTTPResponse.Status = .ok,
    additionalHeaders: [(String, String)] = []
) throws -> Response {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(body)
    var buffer = ByteBuffer()
    buffer.writeBytes(data)
    var headers = HTTPFields()
    headers[.contentType] = "application/json; charset=utf-8"
    for (name, value) in additionalHeaders {
        if let field = HTTPField.Name(name) { headers[field] = value }
    }
    return Response(status: status, headers: headers, body: .init(byteBuffer: buffer))
}

public func deprecatedJSONResponse<T: Encodable>(
    _ body: T,
    successor: String,
    status: HTTPResponse.Status = .ok
) throws -> Response {
    try jsonResponse(body, status: status, additionalHeaders: [
        ("Deprecation", "true"),
        ("Link", "<\(successor)>; rel=\"successor-version\""),
        ("Warning", "299 - \"Deprecated L@tr REST adapter; migrate to XRPC\""),
    ])
}

public func errorResponse(_ error: Error) -> Response {
    if let libraryError = error as? SavedLibraryError {
        let mapped: GatewayError
        switch libraryError {
        case .invalidURL:
            mapped = GatewayError(status: .badRequest, message: "Invalid bookmark subject", code: "InvalidUrl")
        case .bookmarkNotFound, .itemNotFound:
            mapped = GatewayError(status: .notFound, message: "Bookmark not found", code: "BookmarkNotFound")
        case .conflict:
            mapped = GatewayError(status: .conflict, message: "Bookmark changed concurrently", code: "Conflict")
        case let .invalidStoredRecord(uri):
            mapped = GatewayError(status: .badGateway, message: "Invalid stored bookmark: \(uri)", code: "UpstreamFailure")
        }
        return (try? jsonResponse(ErrorBody(error: mapped.code, message: mapped.message), status: mapped.status))
            ?? Response(status: mapped.status)
    }
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
