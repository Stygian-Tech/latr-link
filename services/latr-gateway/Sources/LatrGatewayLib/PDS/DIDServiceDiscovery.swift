import Foundation

public func normalizeServiceBase(_ endpoint: String) -> String {
    var value = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
    while value.hasSuffix("/") {
        value.removeLast()
    }
    return value
}

private func serviceMatchesAppView(id: String?, type: String?) -> Bool {
    let normalizedID = id?.lowercased() ?? ""
    let normalizedType = type ?? ""

    if normalizedID == "#bsky_appview" || normalizedID == "#atproto_appview" {
        return true
    }
    if normalizedType == "BskyAppView" || normalizedType == "AtprotoAppView" {
        return true
    }
    if normalizedType.hasSuffix("AppView") {
        return true
    }
    return false
}

private func serviceMatchesIdentity(id: String?, type: String?) -> Bool {
    let normalizedID = id?.lowercased() ?? ""
    let normalizedType = type ?? ""

    if normalizedID == "#atproto_identity" {
        return true
    }
    if normalizedType == "AtprotoPersonalDataServer", normalizedID.contains("identity") {
        return true
    }
    return false
}

public func parseAppViewEndpointsFromDIDDoc(_ json: [String: Any]) -> [String] {
    parseServiceEndpoints(from: json, matching: serviceMatchesAppView)
}

public func parseIdentityEndpointFromDIDDoc(_ json: [String: Any]) -> String? {
    parseServiceEndpoints(from: json, matching: serviceMatchesIdentity).first
}

public func parsePDSEndpointFromDIDDoc(_ json: [String: Any]) -> String? {
    parsePDSEndpointFromPLCDoc(json)
}

private func parseServiceEndpoints(
    from json: [String: Any],
    matching: (String?, String?) -> Bool
) -> [String] {
    guard let services = json["service"] as? [[String: Any]] else {
        return []
    }

    var seen: Set<String> = []
    var ordered: [String] = []

    for entry in services {
        guard let endpoint = entry["serviceEndpoint"] as? String else { continue }
        let id = entry["id"] as? String
        let type = entry["type"] as? String
        guard matching(id, type) else { continue }

        let normalized = normalizeServiceBase(endpoint)
        guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
        seen.insert(normalized)
        ordered.append(normalized)
    }

    return ordered
}

public func didDocumentURL(for did: String, plcURL: String) -> URL? {
    let trimmed = did.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix("did:") else { return nil }

    if trimmed.hasPrefix("did:plc:") || trimmed.hasPrefix("did:pr:") {
        guard let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            return nil
        }
        var base = plcURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: "\(base)/\(encoded)")
    }

    if trimmed.hasPrefix("did:web:") {
        return didWebDocumentURL(trimmed)
    }

    return nil
}

private func didWebDocumentURL(_ did: String) -> URL? {
    var remainder = String(did.dropFirst("did:web:".count))
    remainder = remainder.replacingOccurrences(of: "%3A", with: ":")
    let segments = remainder.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard let host = segments.first, !host.isEmpty else { return nil }

    if segments.count == 1 {
        return URL(string: "https://\(host)/.well-known/did.json")
    }

    let resourcePath = segments.dropFirst().joined(separator: "/")
    guard !resourcePath.isEmpty else {
        return URL(string: "https://\(host)/.well-known/did.json")
    }
    return URL(string: "https://\(host)/\(resourcePath)/did.json")
}

public func mergeServiceBases(_ groups: [[String]], fallback: [String] = []) -> [String] {
    var seen: Set<String> = []
    var merged: [String] = []

    for group in groups + [fallback] {
        for base in group {
            let normalized = normalizeServiceBase(base)
            guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
            seen.insert(normalized)
            merged.append(normalized)
        }
    }

    return merged
}
