import Foundation

/// ATProto **`application_type: web`** client metadata aligned with `apps/web/public/client-metadata.json`.
public enum WebOAuthClientMetadata {
    enum BuildError: Error {
        case invalidPublicOrigin
    }

    /// Builds JSON for **`/oauth/client-metadata.json`** on the gateway.
    ///
    /// - **`publicOrigin`**: **`client_id`** / **`client_uri`** origin (must match the URL clients fetch).
    /// - **`redirectOrigin`**: SPA origin for **`redirect_uris`** when the web app is on another host.
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
        let clientID = "\(metadataBase)/oauth/client-metadata.json"
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
            scope: ATProtoOAuthScopes.webScope,
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true,
            client_name: "L@tr.link",
            client_uri: metadataBase
        )
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(doc)
    }
}
