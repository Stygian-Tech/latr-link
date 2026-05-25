import Hummingbird
import HTTPTypes

public struct CorsMiddleware<Context: RequestContext>: RouterMiddleware {
    public init() {}

    public func handle(
        _ request: Request,
        context: Context,
        next: (Request, Context) async throws -> Response
    ) async throws -> Response {
        if request.method == .options {
            let headers = corsHeaders(for: request)
            return Response(status: .noContent, headers: headers)
        }

        var response = try await next(request, context)
        let cors = corsHeaders(for: request)
        for field in cors {
            response.headers[field.name] = field.value
        }
        return response
    }

    private func corsHeaders(for request: Request) -> HTTPFields {
        var headers = HTTPFields()
        let origin = request.headers[.origin] ?? "*"
        headers[.accessControlAllowOrigin] = origin
        headers[.accessControlAllowMethods] = "GET, POST, PATCH, DELETE, OPTIONS"
        headers[.accessControlAllowHeaders] =
            "Authorization, Content-Type, DPoP, X-ATProto-Upstream-DPoP, X-Latr-Client-Id, X-Latr-API-Key"
        headers[.vary] = "Origin"
        return headers
    }
}
