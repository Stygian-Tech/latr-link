import Foundation

/// Public ATProto OAuth metadata for the L@tr.link browser extension.
public enum ExtensionOAuthClientMetadata {
    enum BuildError: Error {
        case invalidPublicOrigin
    }

    /// Builds JSON for `/oauth/extension-client-metadata.json`.
    public static func buildJSON(publicOrigin: String, redirectOrigin: String) throws -> Data {
        var metadataBase = publicOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
        if metadataBase.hasSuffix("/") { metadataBase.removeLast() }
        guard let metadataHost = URL(string: metadataBase)?.host, !metadataHost.isEmpty else {
            throw BuildError.invalidPublicOrigin
        }

        var redirectBase = redirectOrigin.trimmingCharacters(in: .whitespacesAndNewlines)
        if redirectBase.hasSuffix("/") { redirectBase.removeLast() }
        guard let redirectHost = URL(string: redirectBase)?.host, !redirectHost.isEmpty else {
            throw BuildError.invalidPublicOrigin
        }

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
            let software_id: String
        }

        let document = MetadataBody(
            client_id: "\(metadataBase)/oauth/extension-client-metadata.json",
            application_type: "web",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            redirect_uris: ["\(redirectBase)/extension/callback"],
            scope: ATProtoOAuthScopes.scope,
            token_endpoint_auth_method: "none",
            dpop_bound_access_tokens: true,
            client_name: "L@tr.link Extension",
            client_uri: metadataBase,
            software_id: "latr-extension"
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(document)
    }
}
