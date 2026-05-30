import Foundation

/// ATProto OAuth client metadata for the LatrKit developer console (`latrkit.dev`).
public enum LatrKitOAuthClientMetadata {
    enum BuildError: Error {
        case invalidPublicOrigin
    }

    public static let scope = "atproto"

    /// Builds JSON for **`/oauth/latrkit-client-metadata.json`** on the gateway.
    public static func buildJSON(publicOrigin: String, redirectOrigin: String? = nil) throws -> Data {
        var trimmed = publicOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard let host = URL(string: trimmed)?.host, !host.isEmpty else {
            throw BuildError.invalidPublicOrigin
        }

        var redirectTrimmed = (redirectOrigin ?? trimmed).trimmingCharacters(in: .whitespacesAndNewlines)
        if redirectTrimmed.hasSuffix("/") { redirectTrimmed.removeLast() }
        guard let redirectHost = URL(string: redirectTrimmed)?.host, !redirectHost.isEmpty else {
            throw BuildError.invalidPublicOrigin
        }

        let metadataBase = trimmed
        let redirectBase = redirectTrimmed
        let clientID = "\(metadataBase)/oauth/latrkit-client-metadata.json"
        let redirect = "\(redirectBase)/callback"

        struct MetadataBody: Encodable {
            let client_id: String
            let application_type: String
            let grant_types: [String]
            let response_types: [String]
            let redirect_uris: [String]
            let scope: String
            let token_endpoint_auth_method: String
            let dpop_bound_access_tokens: Bool
            let client_name: String
            let client_uri: String
        }

        let doc = MetadataBody(
            client_id: clientID,
            application_type: "web",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            redirect_uris: [redirect],
            scope: scope,
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true,
            client_name: "LatrKit Developer Console",
            client_uri: redirectBase
        )
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(doc)
    }
}
