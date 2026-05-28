import Foundation
import HTTPTypes

/// Official first-party client credential (`client-id=base64` pairs in env).
public let latrOfficialClientHeader = "X-Latr-Official-Client"

public func parseOfficialClientCredentials(_ value: String?) -> [String: String] {
    guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return [:]
    }

    var credentials: [String: String] = [:]
    for token in value.split(whereSeparator: { $0 == "," || $0 == ";" }) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { continue }

        let separator = trimmed.firstIndex(where: { $0 == "=" || $0 == ":" })
        guard let separator else { continue }

        let clientID = trimmed[..<separator]
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let credential = trimmed[trimmed.index(after: separator)...]
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !clientID.isEmpty, !credential.isEmpty else { continue }
        credentials[clientID] = credential
    }
    return credentials
}
