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

public struct ErrorBody: Encodable, Sendable {
    public let error: String
    public let message: String
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
