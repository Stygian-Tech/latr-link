import Foundation

public enum AppEnvironment: String, Sendable {
    case local
    case dev
    case prod
    case test
}

public struct GatewayConfig: Sendable {
    public let port: Int
    public let appEnv: AppEnvironment
    public let plcURL: String
    public let oauthRequireKnownClient: Bool
    public let oauthAllowedClientIDs: Set<String>
    public let requireClientAPIKey: Bool
    public let officialClientCredentials: [String: String]
    public let clientRegistryURL: URL
    public let clientRegistrationSecret: String?
    /// SPA origin for OAuth redirect_uris when metadata is served from the gateway.
    public let oauthPublicOrigin: String?

    public init(
        port: Int,
        appEnv: AppEnvironment,
        plcURL: String,
        oauthRequireKnownClient: Bool,
        oauthAllowedClientIDs: Set<String>,
        requireClientAPIKey: Bool = false,
        officialClientCredentials: [String: String] = [:],
        clientRegistryURL: URL = GatewayConfig.defaultClientRegistryURL(),
        clientRegistrationSecret: String? = nil,
        oauthPublicOrigin: String? = nil
    ) {
        self.port = port
        self.appEnv = appEnv
        self.plcURL = plcURL
        self.oauthRequireKnownClient = oauthRequireKnownClient
        self.oauthAllowedClientIDs = oauthAllowedClientIDs
        self.requireClientAPIKey = requireClientAPIKey
        self.officialClientCredentials = officialClientCredentials
        self.clientRegistryURL = clientRegistryURL
        self.clientRegistrationSecret = clientRegistrationSecret
        self.oauthPublicOrigin = oauthPublicOrigin
    }

    public static func defaultClientRegistryURL() -> URL {
        let raw = ProcessInfo.processInfo.environment["LATR_GATEWAY_CLIENT_REGISTRY_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return URL(fileURLWithPath: raw)
        }
        return URL(fileURLWithPath: "data/client-registry.json", relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
    }

    public static func load() -> GatewayConfig {
        let env = ProcessInfo.processInfo.environment
        let appEnvRaw = (env["APP_ENV"] ?? "local").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let appEnv: AppEnvironment
        switch appEnvRaw {
        case "prod": appEnv = .prod
        case "dev": appEnv = .dev
        case "test": appEnv = .test
        default: appEnv = .local
        }

        let port = Int(env["PORT"] ?? "8080") ?? 8080
        let plcURL = (env["PLC_URL"] ?? "https://plc.directory")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        let requireKnown: Bool
        if let raw = env["OAUTH_GATEWAY_REQUIRE_KNOWN_CLIENT"] {
            requireKnown = parseBool(raw)
        } else {
            requireKnown = appEnv == .prod
        }

        let allowed = parseTokenSet(env["OAUTH_GATEWAY_ALLOWED_CLIENT_IDS"])

        let requireClientAPIKey: Bool
        if let raw = env["LATR_GATEWAY_REQUIRE_CLIENT_API_KEY"] {
            requireClientAPIKey = parseBool(raw)
        } else {
            requireClientAPIKey = appEnv == .prod
        }

        let officialClientCredentials = parseOfficialClientCredentials(
            env["LATR_GATEWAY_OFFICIAL_CLIENT_CREDENTIALS"]
        )
        let clientRegistryURL = resolvedClientRegistryURL(from: env)
        let registrationSecret = env["LATR_GATEWAY_CLIENT_REGISTRATION_SECRET"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let oauthPublicOrigin = env["OAUTH_PUBLIC_ORIGIN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return GatewayConfig(
            port: port,
            appEnv: appEnv,
            plcURL: plcURL,
            oauthRequireKnownClient: requireKnown,
            oauthAllowedClientIDs: allowed,
            requireClientAPIKey: requireClientAPIKey,
            officialClientCredentials: officialClientCredentials,
            clientRegistryURL: clientRegistryURL,
            clientRegistrationSecret: registrationSecret?.isEmpty == false ? registrationSecret : nil,
            oauthPublicOrigin: oauthPublicOrigin?.isEmpty == false ? oauthPublicOrigin : nil
        )
    }
}

private func parseBool(_ value: String) -> Bool {
    let v = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return ["1", "true", "yes", "on"].contains(v)
}

private func parseTokenSet(_ value: String?) -> Set<String> {
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return []
    }
    let parts = value.split { $0.isWhitespace || $0 == "," }.map(String.init)
    return Set(parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
}

private func resolvedClientRegistryURL(from env: [String: String]) -> URL {
    let raw = env["LATR_GATEWAY_CLIENT_REGISTRY_PATH"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    if let raw, !raw.isEmpty {
        return URL(fileURLWithPath: raw)
    }
    return GatewayConfig.defaultClientRegistryURL()
}
