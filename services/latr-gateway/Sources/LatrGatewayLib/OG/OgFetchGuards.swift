import Foundation

/// Block obvious SSRF / non-public targets before server-side OG fetches.
public func blockingReasonOGFetch(_ hostname: String) -> String? {
    var norm = hostname.trimmingCharacters(in: .whitespacesAndNewlines)
    if norm.hasPrefix("[") && norm.hasSuffix("]") {
        norm = String(norm.dropFirst().dropLast())
    }
    norm = norm.lowercased()

    if norm == "localhost" || norm == "localhost." || norm == "0" {
        return "blocked_host"
    }
    if norm == "broadcasthost" || norm.hasSuffix(".local") || norm.hasSuffix(".localhost") {
        return "blocked_host"
    }
    if norm == "::1" || norm == "::" || norm == "0000:0000:0000:0000:0000:0000:0000:0000" {
        return "blocked_host"
    }

    let ipv4Pattern = #"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$"#
    if let regex = try? NSRegularExpression(pattern: ipv4Pattern),
       let match = regex.firstMatch(in: norm, range: NSRange(norm.startIndex..., in: norm))
    {
        var parts: [Int] = []
        for index in 1 ... 4 {
            guard let range = Range(match.range(at: index), in: norm) else { return "invalid_host" }
            guard let value = Int(norm[range]) else { return "invalid_host" }
            parts.append(value)
        }
        if parts.contains(where: { $0 > 255 }) { return "invalid_host" }

        let a = parts[0]
        let b = parts[1]
        if a == 127 || a == 10 || a == 0 { return "blocked_ipv4" }
        if a == 169 && b == 254 { return "blocked_ipv4" }
        if a == 192 && b == 168 { return "blocked_ipv4" }
        if a == 172 && (16 ... 31).contains(b) { return "blocked_ipv4" }
        return nil
    }

    let looksLikeIPv6 = norm.range(of: #"^[0-9a-f:]+$"#, options: .regularExpression) != nil
    if looksLikeIPv6,
       norm.contains("fc00:") || norm.contains("fd00:") || norm.hasPrefix("fe80")
    {
        return "blocked_ipv6_scope"
    }

    return nil
}
