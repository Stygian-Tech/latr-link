import Foundation
import HTTPTypes

public protocol DeveloperStore: Sendable {
    func resolveClientID(from headers: HTTPFields, requireClientAPIKey: Bool) async throws -> String?
    func listClients(ownerDID: String) async throws -> [DeveloperClientRecord]
    func createClient(
        ownerDID: String,
        clientID: String,
        displayName: String?,
        isOfficial: Bool
    ) async throws -> DeveloperClientRecord
    func deleteClient(ownerDID: String, clientID: String) async throws
    func listApiKeys(ownerDID: String, clientID: String) async throws -> [DeveloperApiKeyRecord]
    func createApiKey(
        ownerDID: String,
        clientID: String,
        label: String?
    ) async throws -> (record: DeveloperApiKeyRecord, apiKey: String)
    func revokeApiKey(ownerDID: String, clientID: String, keyID: String) async throws
    func recordUsage(clientID: String, routeFamily: String) async throws
    func usageSummaries(ownerDID: String) async throws -> [DeveloperUsageSummaryResponse]
    func assertWithinDailyLimit(clientID: String) async throws
}

public actor InMemoryDeveloperStore: DeveloperStore {
    private let officialEnvCredentials: [String: String]
    var clients: [String: DeveloperClientRecord] = [:]
    var apiKeys: [String: DeveloperApiKeyRecord] = [:]
    var usage: [String: Int] = [:]

    public init(
        officialEnvCredentials: [String: String] = [:],
        snapshot: DeveloperStoreSnapshot? = nil
    ) {
        self.officialEnvCredentials = officialEnvCredentials
        if let snapshot {
            clients = snapshot.clients
            apiKeys = snapshot.apiKeys
            usage = snapshot.usage
        }
        for (clientID, credential) in officialEnvCredentials where clients[clientID] == nil {
            clients[clientID] = DeveloperClientRecord(
                clientID: clientID,
                ownerDID: "official:env",
                displayName: nil,
                isOfficial: true,
                billingStatus: "internal",
                stripeCustomerID: nil,
                dailyRequestLimit: Int.max,
                createdAt: ""
            )
            apiKeys["env:\(clientID)"] = DeveloperApiKeyRecord(
                keyID: "env:\(clientID)",
                clientID: clientID,
                keyHash: hashClientCredential(credential),
                label: "env",
                createdAt: "",
                revokedAt: nil
            )
        }
    }

    public func resolveClientID(from headers: HTTPFields, requireClientAPIKey: Bool) async throws -> String? {
        guard requireClientAPIKey else { return nil }

        if let split = try resolveSplitHeaders(from: headers) {
            return split
        }

        if let legacy = try resolveLegacyOfficialHeader(from: headers) {
            return legacy
        }

        if officialEnvCredentials.isEmpty, clients.isEmpty {
            throw GatewayError(
                status: .forbidden,
                message: "Gateway client credential policy enabled but no clients configured",
                code: "client_credential_policy"
            )
        }

        throw GatewayError(
            status: .forbidden,
            message: "Invalid gateway client credentials",
            code: "invalid_client_credential"
        )
    }

    private func resolveSplitHeaders(from headers: HTTPFields) throws -> String? {
        guard let clientField = HTTPField.Name(latrClientIDHeader),
              let keyField = HTTPField.Name(latrAPIKeyHeader)
        else { return nil }

        let clientID = headers[clientField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let apiKey = headers[keyField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !clientID.isEmpty, !apiKey.isEmpty else { return nil }

        guard clients[clientID] != nil else {
            throw GatewayError(status: .forbidden, message: "Unknown gateway client", code: "unknown_client")
        }

        let hash = hashClientCredential(apiKey)
        let match = apiKeys.values.contains { record in
            record.clientID == clientID &&
                record.revokedAt == nil &&
                timingSafeEqual(record.keyHash, hash)
        }
        guard match else {
            throw GatewayError(
                status: .forbidden,
                message: "Invalid API key",
                code: "invalid_client_credential"
            )
        }
        return clientID
    }

    private func resolveLegacyOfficialHeader(from headers: HTTPFields) throws -> String? {
        guard let credentialField = HTTPField.Name(latrOfficialClientHeader) else { return nil }
        let credential = headers[credentialField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !credential.isEmpty else { return nil }

        for (clientID, expected) in officialEnvCredentials where timingSafeEqual(credential, expected) {
            return clientID
        }

        for record in apiKeys.values where record.revokedAt == nil {
            if timingSafeEqual(hashClientCredential(credential), record.keyHash) {
                return record.clientID
            }
        }

        return nil
    }

    public func listClients(ownerDID: String) async throws -> [DeveloperClientRecord] {
        clients.values
            .filter { $0.ownerDID == ownerDID }
            .sorted { $0.clientID < $1.clientID }
    }

    public func createClient(
        ownerDID: String,
        clientID: String,
        displayName: String?,
        isOfficial: Bool
    ) async throws -> DeveloperClientRecord {
        let normalized = try normalizeClientID(clientID)
        if clients[normalized] != nil {
            throw GatewayError(status: .conflict, message: "Gateway client already exists", code: "client_exists")
        }
        let record = DeveloperClientRecord(
            clientID: normalized,
            ownerDID: ownerDID,
            displayName: normalizeClientDisplayName(displayName),
            isOfficial: isOfficial,
            billingStatus: isOfficial ? "internal" : "preview",
            stripeCustomerID: nil,
            dailyRequestLimit: isOfficial ? Int.max : 10_000,
            createdAt: iso8601Now()
        )
        clients[normalized] = record
        return record
    }

    public func deleteClient(ownerDID: String, clientID: String) async throws {
        let normalized = try normalizeClientID(clientID)
        guard let record = clients[normalized] else {
            throw GatewayError(status: .notFound, message: "Gateway client not found", code: "client_not_found")
        }
        guard record.ownerDID == ownerDID else {
            throw GatewayError(status: .forbidden, message: "Not authorized for this client", code: "forbidden")
        }
        if record.isOfficial {
            throw GatewayError(
                status: .forbidden,
                message: "Official gateway clients cannot be deleted via the developer API",
                code: "official_client"
            )
        }
        clients.removeValue(forKey: normalized)
        apiKeys = apiKeys.filter { $0.value.clientID != normalized }
    }

    public func listApiKeys(ownerDID: String, clientID: String) async throws -> [DeveloperApiKeyRecord] {
        let normalized = try normalizeClientID(clientID)
        try assertOwner(ownerDID: ownerDID, clientID: normalized)
        return apiKeys.values
            .filter { $0.clientID == normalized && !$0.keyID.hasPrefix("env:") }
            .sorted { $0.createdAt < $1.createdAt }
    }

    public func createApiKey(
        ownerDID: String,
        clientID: String,
        label: String?
    ) async throws -> (record: DeveloperApiKeyRecord, apiKey: String) {
        let normalized = try normalizeClientID(clientID)
        try assertOwner(ownerDID: ownerDID, clientID: normalized)
        let apiKey = generateDeveloperApiKey()
        let record = DeveloperApiKeyRecord(
            keyID: newDeveloperKeyID(),
            clientID: normalized,
            keyHash: hashClientCredential(apiKey),
            label: trimmedOptional(label),
            createdAt: iso8601Now(),
            revokedAt: nil
        )
        apiKeys[record.keyID] = record
        return (record, apiKey)
    }

    public func revokeApiKey(ownerDID: String, clientID: String, keyID: String) async throws {
        let normalized = try normalizeClientID(clientID)
        try assertOwner(ownerDID: ownerDID, clientID: normalized)
        guard var record = apiKeys[keyID], record.clientID == normalized else {
            throw GatewayError(status: .notFound, message: "API key not found", code: "key_not_found")
        }
        record = DeveloperApiKeyRecord(
            keyID: record.keyID,
            clientID: record.clientID,
            keyHash: record.keyHash,
            label: record.label,
            createdAt: record.createdAt,
            revokedAt: iso8601Now()
        )
        apiKeys[keyID] = record
    }

    public func recordUsage(clientID: String, routeFamily: String) async throws {
        let key = "\(clientID)|\(todayUTC())|\(routeFamily)"
        usage[key, default: 0] += 1
    }

    public func usageSummaries(ownerDID: String) async throws -> [DeveloperUsageSummaryResponse] {
        let owned = try await listClients(ownerDID: ownerDID)
        let date = todayUTC()
        return owned.map { client in
            let buckets = ["saves", "og-preview", "discover", "auth", "other"].compactMap { family -> DeveloperUsageBucketResponse? in
                let key = "\(client.clientID)|\(date)|\(family)"
                let count = usage[key] ?? 0
                guard count > 0 else { return nil }
                return DeveloperUsageBucketResponse(routeFamily: family, requestCount: count)
            }
            let total = buckets.reduce(0) { $0 + $1.requestCount }
            let limit = client.dailyRequestLimit == Int.max ? nil : client.dailyRequestLimit
            let remaining = limit.map { max(0, $0 - total) }
            return DeveloperUsageSummaryResponse(
                clientId: client.clientID,
                usageDate: date,
                buckets: buckets,
                dailyLimit: limit,
                remaining: remaining
            )
        }
    }

    public func assertWithinDailyLimit(clientID: String) async throws {
        guard let client = clients[clientID], client.dailyRequestLimit != Int.max else { return }
        let date = todayUTC()
        let total = usage.filter { $0.key.hasPrefix("\(clientID)|\(date)|") }.reduce(0) { $0 + $1.value }
        if total >= client.dailyRequestLimit {
            throw GatewayError(
                status: .tooManyRequests,
                message: "Daily request limit exceeded for client",
                code: "usage_limit_exceeded"
            )
        }
    }

    private func assertOwner(ownerDID: String, clientID: String) throws {
        guard let record = clients[clientID], record.ownerDID == ownerDID else {
            throw GatewayError(status: .forbidden, message: "Not authorized for this client", code: "forbidden")
        }
    }
}

private func trimmedOptional(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}
