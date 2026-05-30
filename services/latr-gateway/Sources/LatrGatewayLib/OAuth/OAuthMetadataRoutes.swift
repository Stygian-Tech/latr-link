import Foundation
import Hummingbird
import HTTPTypes
import NIOCore

/// Public OAuth client metadata (no auth). Used when the web SPA is deployment-protected.
enum OAuthMetadataRoutes {
    static func register(
        on router: Router<BasicRequestContext>,
        oauthRedirectOrigin: String?,
        oauthLatrkitRedirectOrigin: String?
    ) {
        router.get("oauth/client-metadata.json") { request, _ in
            try webMetadataResponse(request: request, oauthRedirectOrigin: oauthRedirectOrigin)
        }
        router.get("oauth/latrkit-client-metadata.json") { request, _ in
            try latrkitMetadataResponse(request: request, oauthRedirectOrigin: oauthLatrkitRedirectOrigin)
        }
    }

    private static func webMetadataResponse(
        request: Request,
        oauthRedirectOrigin: String?
    ) throws -> Response {
        guard let metadataOrigin = OAuthPublicOrigin.resolve(request: request, configuredOrigin: nil) else {
            throw GatewayError(
                status: .internalServerError,
                message: "Cannot resolve public origin for OAuth metadata",
                code: "oauth_metadata_origin"
            )
        }

        let redirectOrigin: String = {
            guard let raw = oauthRedirectOrigin?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty
            else { return metadataOrigin }
            return raw
        }()

        let data: Data
        do {
            data = try WebOAuthClientMetadata.buildJSON(
                publicOrigin: metadataOrigin,
                redirectOrigin: redirectOrigin
            )
        } catch {
            throw GatewayError(
                status: .internalServerError,
                message: "Invalid public origin for OAuth metadata JSON",
                code: "oauth_metadata_invalid"
            )
        }

        return try jsonDataResponse(data)
    }

    private static func latrkitMetadataResponse(
        request: Request,
        oauthRedirectOrigin: String?
    ) throws -> Response {
        guard let metadataOrigin = OAuthPublicOrigin.resolve(request: request, configuredOrigin: nil) else {
            throw GatewayError(
                status: .internalServerError,
                message: "Cannot resolve public origin for OAuth metadata",
                code: "oauth_metadata_origin"
            )
        }

        let redirectOrigin: String = {
            guard let raw = oauthRedirectOrigin?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty
            else { return metadataOrigin }
            return raw
        }()

        let data: Data
        do {
            data = try LatrKitOAuthClientMetadata.buildJSON(
                publicOrigin: metadataOrigin,
                redirectOrigin: redirectOrigin
            )
        } catch {
            throw GatewayError(
                status: .internalServerError,
                message: "Invalid public origin for LatrKit OAuth metadata JSON",
                code: "oauth_metadata_invalid"
            )
        }

        return try jsonDataResponse(data)
    }

    private static func jsonDataResponse(_ data: Data) throws -> Response {
        var headers = HTTPFields()
        headers[.contentType] = "application/json; charset=utf-8"
        headers[.accessControlAllowOrigin] = "*"
        var buffer = ByteBuffer()
        buffer.writeBytes(data)
        return Response(status: .ok, headers: headers, body: .init(byteBuffer: buffer))
    }
}
