import Foundation

/// Protocol-independent developer-console operations shared by XRPC and REST.
public enum DeveloperOperations {
    public static func listClients(
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> ListDeveloperClientsResponse {
        let records = try await services.developerStore.listClients(ownerDID: auth.did)
        return ListDeveloperClientsResponse(
            clients: records.map {
                DeveloperClientSummaryResponse(
                    clientId: $0.clientID,
                    displayName: $0.displayName,
                    kind: "developer",
                    createdAt: $0.createdAt
                )
            }
        )
    }

    public static func createClient(
        clientID: String,
        displayName: String?,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> DeveloperClientSummaryResponse {
        let created = try await services.developerStore.createClient(
            ownerDID: auth.did,
            clientID: clientID,
            displayName: displayName,
            isOfficial: false
        )
        return DeveloperClientSummaryResponse(
            clientId: created.clientID,
            displayName: created.displayName,
            kind: "developer",
            createdAt: created.createdAt
        )
    }

    public static func deleteClient(
        clientID: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        try await services.developerStore.deleteClient(ownerDID: auth.did, clientID: clientID)
        return SimpleOKResponse(ok: true)
    }

    public static func listKeys(
        clientID: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> ListDeveloperApiKeysResponse {
        let keys = try await services.developerStore.listApiKeys(ownerDID: auth.did, clientID: clientID)
        return ListDeveloperApiKeysResponse(
            keys: keys.map {
                DeveloperApiKeySummaryResponse(
                    keyId: $0.keyID,
                    label: $0.label,
                    createdAt: $0.createdAt,
                    revokedAt: $0.revokedAt
                )
            }
        )
    }

    public static func createKey(
        clientID: String,
        label: String?,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> CreateDeveloperApiKeyResponse {
        let created = try await services.developerStore.createApiKey(
            ownerDID: auth.did,
            clientID: clientID,
            label: label
        )
        return CreateDeveloperApiKeyResponse(
            keyId: created.record.keyID,
            clientId: created.record.clientID,
            apiKey: created.apiKey,
            label: created.record.label,
            createdAt: created.record.createdAt
        )
    }

    public static func revokeKey(
        clientID: String,
        keyID: String,
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> SimpleOKResponse {
        try await services.developerStore.revokeApiKey(
            ownerDID: auth.did,
            clientID: clientID,
            keyID: keyID
        )
        return SimpleOKResponse(ok: true)
    }

    public static func getUsage(
        auth: AuthContext,
        services: GatewayServices
    ) async throws -> ListDeveloperUsageResponse {
        ListDeveloperUsageResponse(
            usage: try await services.developerStore.usageSummaries(ownerDID: auth.did)
        )
    }
}
