import Foundation

public let latrClientIDHeader = "X-Latr-Client-Id"
public let latrAPIKeyHeader = "X-Latr-API-Key"

public func generateDeveloperApiKey() -> String {
    "lk_\(Data(secureRandomBytes(count: 32)).base64EncodedString())"
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

public func newDeveloperKeyID() -> String {
    UUID().uuidString.lowercased()
}

public func iso8601Now() -> String {
    ISO8601DateFormatter().string(from: Date())
}

public func todayUTC() -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
}

public func routeFamily(for path: String) -> String {
    if let nsid = path.split(separator: "/").last,
       let method = LatrXRPCMethod(rawValue: String(nsid))
    {
        return "xrpc:\(method.rawValue)"
    }
    if path.contains("/saves") { return "saves" }
    if path.contains("/og-preview") { return "og-preview" }
    if path.contains("/discover") { return "discover" }
    if path.contains("/auth/probe") { return "auth" }
    return "other"
}
