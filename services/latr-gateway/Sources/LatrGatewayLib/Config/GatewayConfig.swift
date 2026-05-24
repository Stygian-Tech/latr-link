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

    public init(
        port: Int,
        appEnv: AppEnvironment,
        plcURL: String,
        oauthRequireKnownClient: Bool,
        oauthAllowedClientIDs: Set<String>
    ) {
        self.port = port
        self.appEnv = appEnv
        self.plcURL = plcURL
        self.oauthRequireKnownClient = oauthRequireKnownClient
        self.oauthAllowedClientIDs = oauthAllowedClientIDs
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

        return GatewayConfig(
            port: port,
            appEnv: appEnv,
            plcURL: plcURL,
            oauthRequireKnownClient: requireKnown,
            oauthAllowedClientIDs: allowed
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
