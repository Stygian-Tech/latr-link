import Crypto
import Foundation
import HTTPTypes
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public struct RegisteredClientRecord: Codable, Sendable, Equatable {
    public var keyHash: String
    public var displayName: String?
    public var createdAt: String

    public init(keyHash: String, displayName: String? = nil, createdAt: String) {
        self.keyHash = keyHash
        self.displayName = displayName
        self.createdAt = createdAt
    }
}

private struct ClientRegistryFile: Codable {
    var clients: [String: RegisteredClientRecord]
}

public struct RegisteredClientSummary: Encodable, Sendable {
    public let clientId: String
    public let displayName: String?
    public let createdAt: String
    public let source: String
}

public struct RegisterClientBody: Decodable, Sendable {
    public let clientId: String
    public let displayName: String?
}

public struct RegisterClientResponse: Encodable, Sendable {
    public let clientId: String
    public let apiKey: String
    public let displayName: String?
    public let createdAt: String
}

public struct ListClientsResponse: Encodable, Sendable {
    public let clients: [RegisteredClientSummary]
}

/// Persisted gateway client credentials merged with bootstrap keys from the environment.
public actor ClientRegistry {
    private let bootstrapKeys: [String: String]
    private let registryURL: URL
    private var records: [String: RegisteredClientRecord]

    public init(bootstrapKeys: [String: String], registryURL: URL) {
        self.bootstrapKeys = bootstrapKeys
        self.registryURL = registryURL
        self.records = Self.loadRecords(from: registryURL)
    }

    public func resolveClientID(from headers: HTTPFields, requireClientAPIKey: Bool) throws -> String? {
        guard requireClientAPIKey else { return nil }

        guard let clientIDField = HTTPField.Name(latrClientIDHeader),
              let apiKeyField = HTTPField.Name(latrAPIKeyHeader)
        else {
            throw GatewayError(
                status: .internalServerError,
                message: "Gateway client API key headers unavailable",
                code: "internal_error"
            )
        }

        let clientID = headers[clientIDField]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let apiKey = headers[apiKeyField]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard !clientID.isEmpty else {
            throw GatewayError(
                status: .unauthorized,
                message: "Missing \(latrClientIDHeader) header",
                code: "missing_client_id"
            )
        }

        guard !apiKey.isEmpty else {
            throw GatewayError(
                status: .unauthorized,
                message: "Missing \(latrAPIKeyHeader) header",
                code: "missing_api_key"
            )
        }

        if let expected = bootstrapKeys[clientID], timingSafeEqual(apiKey, expected) {
            return clientID
        }

        if let record = records[clientID],
           timingSafeEqual(hashAPIKey(apiKey), record.keyHash)
        {
            return clientID
        }

        if bootstrapKeys[clientID] != nil || records[clientID] != nil {
            throw GatewayError(
                status: .forbidden,
                message: "Invalid gateway client API key",
                code: "invalid_api_key"
            )
        }

        if bootstrapKeys.isEmpty, records.isEmpty {
            throw GatewayError(
                status: .forbidden,
                message: "Gateway client API key policy enabled but no keys configured",
                code: "client_api_key_policy"
            )
        }

        throw GatewayError(
            status: .forbidden,
            message: "Unknown gateway client",
            code: "client_forbidden"
        )
    }

    @discardableResult
    public func registerClient(clientID: String, displayName: String?) throws -> RegisterClientResponse {
        let normalizedID = try normalizeClientID(clientID)
        let trimmedName = displayName?.trimmingCharacters(in: .whitespacesAndNewlines)

        if bootstrapKeys[normalizedID] != nil || records[normalizedID] != nil {
            throw GatewayError(
                status: .conflict,
                message: "Gateway client already registered",
                code: "client_exists"
            )
        }

        let apiKey = generateAPIKey()
        let createdAt = ISO8601DateFormatter().string(from: Date())
        records[normalizedID] = RegisteredClientRecord(
            keyHash: hashAPIKey(apiKey),
            displayName: trimmedName?.isEmpty == false ? trimmedName : nil,
            createdAt: createdAt
        )
        try persist()

        return RegisterClientResponse(
            clientId: normalizedID,
            apiKey: apiKey,
            displayName: trimmedName?.isEmpty == false ? trimmedName : nil,
            createdAt: createdAt
        )
    }

    public func listClients() -> [RegisteredClientSummary] {
        var summaries: [RegisteredClientSummary] = bootstrapKeys.keys.sorted().map { clientID in
            RegisteredClientSummary(
                clientId: clientID,
                displayName: nil,
                createdAt: "",
                source: "bootstrap"
            )
        }

        for (clientID, record) in records.sorted(by: { $0.key < $1.key }) {
            if bootstrapKeys[clientID] != nil { continue }
            summaries.append(
                RegisteredClientSummary(
                    clientId: clientID,
                    displayName: record.displayName,
                    createdAt: record.createdAt,
                    source: "registered"
                )
            )
        }

        return summaries.sorted { $0.clientId < $1.clientId }
    }

    @discardableResult
    public func revokeClient(clientID: String) throws -> Bool {
        let normalizedID = try normalizeClientID(clientID)

        if bootstrapKeys[normalizedID] != nil {
            throw GatewayError(
                status: .forbidden,
                message: "Bootstrap gateway clients cannot be revoked via the registry API",
                code: "bootstrap_client"
            )
        }

        guard records.removeValue(forKey: normalizedID) != nil else {
            throw GatewayError(
                status: .notFound,
                message: "Gateway client not found",
                code: "client_not_found"
            )
        }

        try persist()
        return true
    }

    private func persist() throws {
        let directory = registryURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let payload = ClientRegistryFile(clients: records)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(payload)
        try data.write(to: registryURL, options: .atomic)
    }

    private static func loadRecords(from url: URL) -> [String: RegisteredClientRecord] {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(ClientRegistryFile.self, from: data)
        else {
            return [:]
        }
        return file.clients
    }
}

public func normalizeClientID(_ raw: String) throws -> String {
    let clientID = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !clientID.isEmpty else {
        throw GatewayError(status: .badRequest, message: "clientId is required", code: "missing_client_id")
    }

    let pattern = try NSRegularExpression(pattern: #"^[a-z][a-z0-9-]{0,62}$"#)
    let range = NSRange(clientID.startIndex..., in: clientID)
    guard pattern.firstMatch(in: clientID, range: range) != nil else {
        throw GatewayError(
            status: .badRequest,
            message: "clientId must start with a letter and contain only lowercase letters, digits, and hyphens",
            code: "invalid_client_id"
        )
    }

    return clientID
}

public func hashAPIKey(_ apiKey: String) -> String {
    let digest = SHA256.hash(data: Data(apiKey.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}

public func generateAPIKey() -> String {
    let bytes = secureRandomBytes(count: 32)
    let encoded = Data(bytes)
        .base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    return "latr_\(encoded)"
}

private func secureRandomBytes(count: Int) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: count)
    #if canImport(Darwin)
    let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    precondition(status == errSecSuccess, "Failed to generate API key material")
    #else
    let fd = open("/dev/urandom", O_RDONLY)
    precondition(fd >= 0, "Failed to open /dev/urandom")
    defer { close(fd) }
    var remaining = count
    var offset = 0
    while remaining > 0 {
        let readCount = read(fd, &bytes[offset], remaining)
        precondition(readCount > 0, "Failed to read /dev/urandom")
        remaining -= readCount
        offset += readCount
    }
    #endif
    return bytes
}

public let clientRegistrationSecretHeader = "Authorization"

public func assertRegistrationAuthorized(_ headers: HTTPFields, config: GatewayConfig) throws {
    if config.appEnv == .local, config.clientRegistrationSecret == nil {
        return
    }

    guard let secret = config.clientRegistrationSecret?.trimmingCharacters(in: .whitespacesAndNewlines),
          !secret.isEmpty
    else {
        throw GatewayError(
            status: .forbidden,
            message: "Client registration is disabled",
            code: "registration_disabled"
        )
    }

    guard let authorization = headers[.authorization]?
        .trimmingCharacters(in: .whitespacesAndNewlines),
        !authorization.isEmpty
    else {
        throw GatewayError(
            status: .unauthorized,
            message: "Missing registration Authorization header",
            code: "registration_unauthorized"
        )
    }

    guard let token = extractBearerToken(from: authorization) else {
        throw GatewayError(
            status: .unauthorized,
            message: "Registration Authorization must use Bearer scheme",
            code: "registration_unauthorized"
        )
    }

    guard timingSafeEqual(token, secret) else {
        throw GatewayError(
            status: .forbidden,
            message: "Invalid client registration secret",
            code: "registration_forbidden"
        )
    }
}

public func extractBearerToken(from authorization: String) -> String? {
    let trimmed = authorization.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.lowercased().hasPrefix("bearer ") else { return nil }
    let token = String(trimmed.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
    return token.isEmpty ? nil : token
}

func timingSafeEqual(_ lhs: String, _ rhs: String) -> Bool {
    let left = Array(lhs.utf8)
    let right = Array(rhs.utf8)
    guard left.count == right.count else { return false }
    var difference: UInt8 = 0
    for index in left.indices {
        difference |= left[index] ^ right[index]
    }
    return difference == 0
}
