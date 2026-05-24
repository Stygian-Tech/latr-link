import Foundation

public func normalizePDSBase(_ endpoint: String) -> String {
    var value = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
    while value.hasSuffix("/") {
        value.removeLast()
    }
    return value
}

public func parsePDSEndpointFromPLCDoc(_ json: [String: Any]) -> String? {
    guard let services = json["service"] as? [[String: Any]] else {
        return nil
    }

    for entry in services {
        guard let endpoint = entry["serviceEndpoint"] as? String else { continue }
        let id = entry["id"] as? String
        let type = entry["type"] as? String
        if id == "#atproto_pds" || type == "AtprotoPersonalDataServer" {
            return normalizePDSBase(endpoint)
        }
    }
    return nil
}

public func resolvePDSBase(repoDID: String, plcURL: String, fetchData: @Sendable (URL) async throws -> Data) async throws -> String? {
    guard repoDID.hasPrefix("did:") else { return nil }
    guard let encoded = repoDID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
        return nil
    }
    guard let url = URL(string: "\(plcURL)/\(encoded)") else { return nil }

    let data = try await fetchData(url)
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
    }
    return parsePDSEndpointFromPLCDoc(json)
}
