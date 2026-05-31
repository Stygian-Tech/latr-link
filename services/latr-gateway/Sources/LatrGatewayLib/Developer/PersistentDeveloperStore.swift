import Foundation
import HTTPTypes
import Logging
import PostgresNIO

public struct DeveloperStoreSnapshot: Codable, Sendable {
    var clients: [String: DeveloperClientRecord]
    var apiKeys: [String: DeveloperApiKeyRecord]
    var usage: [String: Int]
}

/// JSON-backed developer store for local dev without `DATABASE_URL`.
public actor PersistentDeveloperStore: DeveloperStore {
    private let backing: InMemoryDeveloperStore
    private let storeURL: URL

    public init(officialEnvCredentials: [String: String], storeURL: URL) {
        self.storeURL = storeURL
        let snapshot = Self.loadSnapshot(from: storeURL)
        self.backing = InMemoryDeveloperStore(
            officialEnvCredentials: officialEnvCredentials,
            snapshot: snapshot
        )
    }

    private func persistSnapshot(_ snapshot: DeveloperStoreSnapshot) throws {
        let directory = storeURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(snapshot)
            try data.write(to: storeURL, options: .atomic)
        } catch {
            throw GatewayError(
                status: .internalServerError,
                message: "Failed to persist developer store at \(storeURL.path): \(error.localizedDescription)",
                code: "developer_store_persist_failed"
            )
        }
    }

    private func persist() async throws {
        let snapshot = await backing.snapshot()
        try persistSnapshot(snapshot)
    }

    private func commit<T>(
        _ operation: () async throws -> T
    ) async throws -> T {
        let before = await backing.snapshot()
        let result = try await operation()
        do {
            try await persist()
        } catch {
            await backing.restoreSnapshot(before)
            throw error
        }
        return result
    }

    public func resolveClientID(from headers: HTTPFields, requireClientAPIKey: Bool) async throws -> String? {
        try await backing.resolveClientID(from: headers, requireClientAPIKey: requireClientAPIKey)
    }

    public func listClients(ownerDID: String) async throws -> [DeveloperClientRecord] {
        try await backing.listClients(ownerDID: ownerDID)
    }

    public func createClient(
        ownerDID: String,
        clientID: String,
        displayName: String?,
        isOfficial: Bool
    ) async throws -> DeveloperClientRecord {
        try await commit {
            try await backing.createClient(
                ownerDID: ownerDID,
                clientID: clientID,
                displayName: displayName,
                isOfficial: isOfficial
            )
        }
    }

    public func deleteClient(ownerDID: String, clientID: String) async throws {
        try await commit {
            try await backing.deleteClient(ownerDID: ownerDID, clientID: clientID)
        }
    }

    public func listApiKeys(ownerDID: String, clientID: String) async throws -> [DeveloperApiKeyRecord] {
        try await backing.listApiKeys(ownerDID: ownerDID, clientID: clientID)
    }

    public func createApiKey(
        ownerDID: String,
        clientID: String,
        label: String?
    ) async throws -> (record: DeveloperApiKeyRecord, apiKey: String) {
        try await commit {
            try await backing.createApiKey(ownerDID: ownerDID, clientID: clientID, label: label)
        }
    }

    public func revokeApiKey(ownerDID: String, clientID: String, keyID: String) async throws {
        try await commit {
            try await backing.revokeApiKey(ownerDID: ownerDID, clientID: clientID, keyID: keyID)
        }
    }

    public func recordUsage(clientID: String, routeFamily: String) async throws {
        try await commit {
            try await backing.recordUsage(clientID: clientID, routeFamily: routeFamily)
        }
    }

    public func usageSummaries(ownerDID: String) async throws -> [DeveloperUsageSummaryResponse] {
        try await backing.usageSummaries(ownerDID: ownerDID)
    }

    public func assertWithinDailyLimit(clientID: String) async throws {
        try await backing.assertWithinDailyLimit(clientID: clientID)
    }

    private static func loadSnapshot(from url: URL) -> DeveloperStoreSnapshot? {
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(DeveloperStoreSnapshot.self, from: data)
        else { return nil }
        return snapshot
    }
}

extension InMemoryDeveloperStore {
    fileprivate func snapshot() -> DeveloperStoreSnapshot {
        DeveloperStoreSnapshot(clients: clients, apiKeys: apiKeys, usage: usage)
    }

    fileprivate func restoreSnapshot(_ snapshot: DeveloperStoreSnapshot) {
        clients = snapshot.clients
        apiKeys = snapshot.apiKeys
        usage = snapshot.usage
    }
}

public enum DeveloperStoreFactory {
    public static func make(
        config: GatewayConfig,
        postgres: PostgresClient? = nil,
        logger: Logger = Logger(label: "latr-gateway")
    ) -> any DeveloperStore {
        if config.appEnv == .test {
            return InMemoryDeveloperStore(officialEnvCredentials: config.officialClientCredentials)
        }
        if let postgres, config.databaseURL != nil {
            return PostgresDeveloperStore(
                pool: postgres,
                officialEnvCredentials: config.officialClientCredentials,
                logger: logger
            )
        }
        return PersistentDeveloperStore(
            officialEnvCredentials: config.officialClientCredentials,
            storeURL: config.developerStoreURL
        )
    }
}
