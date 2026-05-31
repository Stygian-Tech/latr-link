import Foundation
import HTTPTypes
import Logging
import PostgresNIO

/// Postgres-backed developer store (Supabase). Apply `migrations/001_developer_console.sql` before use.
public actor PostgresDeveloperStore: DeveloperStore {
    private let pool: PostgresClient
    private let officialEnvCredentials: [String: String]
    private let logger: Logger

    public init(
        pool: PostgresClient,
        officialEnvCredentials: [String: String] = [:],
        logger: Logger
    ) {
        self.pool = pool
        self.officialEnvCredentials = officialEnvCredentials
        self.logger = logger
    }

    public func resolveClientID(from headers: HTTPFields, requireClientAPIKey: Bool) async throws -> String? {
        guard requireClientAPIKey else { return nil }

        if let split = try await resolveSplitHeaders(from: headers) {
            return split
        }

        if let legacy = try await resolveLegacyOfficialHeader(from: headers) {
            return legacy
        }

        if officialEnvCredentials.isEmpty, try await hasAnyDeveloperClients() == false {
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

    public func listClients(ownerDID: String) async throws -> [DeveloperClientRecord] {
        let rows = try await query(
            """
            SELECT client_id, owner_did, display_name, is_official, billing_status, stripe_customer_id, daily_request_limit, created_at
            FROM developer_clients
            WHERE owner_did = \(ownerDID)
            ORDER BY client_id
            """
        )

        var records: [DeveloperClientRecord] = []
        for try await row in rows {
            records.append(try decodeClientRecord(from: row))
        }
        return records
    }

    public func createClient(
        ownerDID: String,
        clientID: String,
        displayName: String?,
        isOfficial: Bool
    ) async throws -> DeveloperClientRecord {
        let normalized = try normalizeClientID(clientID)
        let billingStatus = isOfficial ? "internal" : "preview"
        let dailyLimit = isOfficial ? Int32.max : 10_000

        do {
            let rows = try await query(
                """
                INSERT INTO developer_clients (
                    client_id, owner_did, display_name, is_official, billing_status, daily_request_limit
                )
                VALUES (
                    \(normalized), \(ownerDID), \(normalizeClientDisplayName(displayName)), \(isOfficial), \(billingStatus), \(dailyLimit)
                )
                RETURNING client_id, owner_did, display_name, is_official, billing_status, stripe_customer_id, daily_request_limit, created_at
                """
            )

            for try await row in rows {
                return try decodeClientRecord(from: row)
            }

            throw GatewayError(
                status: .internalServerError,
                message: "Failed to create gateway client",
                code: "database_error"
            )
        } catch {
            throw mapDatabaseError(error, conflictMessage: "Gateway client already exists", conflictCode: "client_exists")
        }
    }

    public func deleteClient(ownerDID: String, clientID: String) async throws {
        let normalized = try normalizeClientID(clientID)
        try await assertOwner(ownerDID: ownerDID, clientID: normalized)

        let rows = try await query(
            """
            DELETE FROM developer_clients
            WHERE client_id = \(normalized) AND owner_did = \(ownerDID)
            RETURNING client_id
            """
        )

        var deleted = false
        for try await _ in rows {
            deleted = true
        }
        guard deleted else {
            throw GatewayError(status: .notFound, message: "Gateway client not found", code: "client_not_found")
        }
    }

    public func listApiKeys(ownerDID: String, clientID: String) async throws -> [DeveloperApiKeyRecord] {
        let normalized = try normalizeClientID(clientID)
        try await assertOwner(ownerDID: ownerDID, clientID: normalized)

        let rows = try await query(
            """
            SELECT key_id, client_id, key_hash, label, created_at, revoked_at
            FROM developer_api_keys
            WHERE client_id = \(normalized)
            ORDER BY created_at ASC
            """
        )

        var records: [DeveloperApiKeyRecord] = []
        for try await row in rows {
            records.append(try decodeApiKeyRecord(from: row))
        }
        return records
    }

    public func createApiKey(
        ownerDID: String,
        clientID: String,
        label: String?
    ) async throws -> (record: DeveloperApiKeyRecord, apiKey: String) {
        let normalized = try normalizeClientID(clientID)
        try await assertOwner(ownerDID: ownerDID, clientID: normalized)

        let apiKey = generateDeveloperApiKey()
        let keyID = newDeveloperKeyID()
        let keyHash = hashClientCredential(apiKey)
        let trimmedLabel = trimmedOptional(label)

        do {
            let rows = try await query(
                """
                INSERT INTO developer_api_keys (key_id, client_id, key_hash, label)
                VALUES (\(keyID), \(normalized), \(keyHash), \(trimmedLabel))
                RETURNING key_id, client_id, key_hash, label, created_at, revoked_at
                """
            )

            for try await row in rows {
                let record = try decodeApiKeyRecord(from: row)
                return (record, apiKey)
            }

            throw GatewayError(
                status: .internalServerError,
                message: "Failed to create API key",
                code: "database_error"
            )
        } catch {
            throw mapDatabaseError(error)
        }
    }

    public func revokeApiKey(ownerDID: String, clientID: String, keyID: String) async throws {
        let normalized = try normalizeClientID(clientID)
        try await assertOwner(ownerDID: ownerDID, clientID: normalized)

        let rows = try await query(
            """
            UPDATE developer_api_keys
            SET revoked_at = NOW()
            WHERE key_id = \(keyID) AND client_id = \(normalized) AND revoked_at IS NULL
            RETURNING key_id
            """
        )

        var revoked = false
        for try await _ in rows {
            revoked = true
        }
        guard revoked else {
            throw GatewayError(status: .notFound, message: "API key not found", code: "key_not_found")
        }
    }

    public func recordUsage(clientID: String, routeFamily: String) async throws {
        if officialEnvCredentials[clientID] != nil { return }

        let usageDate = todayUTC()
        do {
            _ = try await query(
                """
                INSERT INTO developer_usage_daily (client_id, usage_date, route_family, request_count)
                VALUES (\(clientID), \(usageDate)::date, \(routeFamily), 1)
                ON CONFLICT (client_id, usage_date, route_family)
                DO UPDATE SET request_count = developer_usage_daily.request_count + 1
                """
            )
        } catch {
            throw mapDatabaseError(error)
        }
    }

    public func usageSummaries(ownerDID: String) async throws -> [DeveloperUsageSummaryResponse] {
        let owned = try await listClients(ownerDID: ownerDID)
        let usageDate = todayUTC()
        let families = ["saves", "og-preview", "discover", "auth", "other"]

        return try await withThrowingTaskGroup(of: DeveloperUsageSummaryResponse.self) { group in
            for client in owned {
                group.addTask {
                    let rows = try await self.query(
                        """
                        SELECT route_family, request_count
                        FROM developer_usage_daily
                        WHERE client_id = \(client.clientID) AND usage_date = \(usageDate)::date
                        """
                    )

                    var counts: [String: Int] = [:]
                    for try await row in rows {
                        let (routeFamily, requestCount) = try row.decode((String, Int32).self)
                        counts[routeFamily] = Int(requestCount)
                    }

                    let buckets = families.compactMap { family -> DeveloperUsageBucketResponse? in
                        let count = counts[family] ?? 0
                        guard count > 0 else { return nil }
                        return DeveloperUsageBucketResponse(routeFamily: family, requestCount: count)
                    }
                    let total = buckets.reduce(0) { $0 + $1.requestCount }
                    let limit = client.dailyRequestLimit == Int.max ? nil : client.dailyRequestLimit
                    let remaining = limit.map { max(0, $0 - total) }
                    return DeveloperUsageSummaryResponse(
                        clientId: client.clientID,
                        usageDate: usageDate,
                        buckets: buckets,
                        dailyLimit: limit,
                        remaining: remaining
                    )
                }
            }

            var summaries: [DeveloperUsageSummaryResponse] = []
            for try await summary in group {
                summaries.append(summary)
            }
            return summaries.sorted { $0.clientId < $1.clientId }
        }
    }

    public func assertWithinDailyLimit(clientID: String) async throws {
        if officialEnvCredentials[clientID] != nil { return }

        let usageDate = todayUTC()
        let rows = try await query(
            """
            SELECT c.daily_request_limit, COALESCE(SUM(u.request_count), 0) AS total
            FROM developer_clients c
            LEFT JOIN developer_usage_daily u
              ON u.client_id = c.client_id AND u.usage_date = \(usageDate)::date
            WHERE c.client_id = \(clientID)
            GROUP BY c.daily_request_limit
            """
        )

        for try await row in rows {
            let (dailyLimit, total) = try row.decode((Int32, Int64).self)
            if dailyLimit == Int32.max { return }
            if Int(total) >= Int(dailyLimit) {
                throw GatewayError(
                    status: .tooManyRequests,
                    message: "Daily request limit exceeded for client",
                    code: "usage_limit_exceeded"
                )
            }
            return
        }
    }

    // MARK: - Auth helpers

    private func resolveSplitHeaders(from headers: HTTPFields) async throws -> String? {
        guard let clientField = HTTPField.Name(latrClientIDHeader),
              let keyField = HTTPField.Name(latrAPIKeyHeader)
        else { return nil }

        let clientID = headers[clientField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let apiKey = headers[keyField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !clientID.isEmpty, !apiKey.isEmpty else { return nil }

        if let envCredential = officialEnvCredentials[clientID] {
            let hash = hashClientCredential(apiKey)
            guard timingSafeEqual(hash, hashClientCredential(envCredential)) else {
                throw GatewayError(
                    status: .forbidden,
                    message: "Invalid API key",
                    code: "invalid_client_credential"
                )
            }
            return clientID
        }

        guard try await clientExists(clientID) else {
            throw GatewayError(status: .forbidden, message: "Unknown gateway client", code: "unknown_client")
        }

        let hash = hashClientCredential(apiKey)
        guard try await apiKeyMatches(clientID: clientID, keyHash: hash) else {
            throw GatewayError(
                status: .forbidden,
                message: "Invalid API key",
                code: "invalid_client_credential"
            )
        }
        return clientID
    }

    private func resolveLegacyOfficialHeader(from headers: HTTPFields) async throws -> String? {
        guard let credentialField = HTTPField.Name(latrOfficialClientHeader) else { return nil }
        let credential = headers[credentialField]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !credential.isEmpty else { return nil }

        for (clientID, expected) in officialEnvCredentials where timingSafeEqual(credential, expected) {
            return clientID
        }

        let hash = hashClientCredential(credential)
        let rows = try await query(
            """
            SELECT client_id
            FROM developer_api_keys
            WHERE key_hash = \(hash) AND revoked_at IS NULL
            LIMIT 1
            """
        )

        for try await row in rows {
            let (clientID,) = try row.decode((String,).self)
            return clientID
        }

        return nil
    }

    private func hasAnyDeveloperClients() async throws -> Bool {
        let rows = try await query("SELECT 1 FROM developer_clients LIMIT 1")
        for try await _ in rows {
            return true
        }
        return false
    }

    private func clientExists(_ clientID: String) async throws -> Bool {
        let rows = try await query(
            """
            SELECT 1 FROM developer_clients WHERE client_id = \(clientID) LIMIT 1
            """
        )
        for try await _ in rows {
            return true
        }
        return false
    }

    private func apiKeyMatches(clientID: String, keyHash: String) async throws -> Bool {
        let rows = try await query(
            """
            SELECT 1
            FROM developer_api_keys
            WHERE client_id = \(clientID) AND key_hash = \(keyHash) AND revoked_at IS NULL
            LIMIT 1
            """
        )
        for try await _ in rows {
            return true
        }
        return false
    }

    private func assertOwner(ownerDID: String, clientID: String) async throws {
        let rows = try await query(
            """
            SELECT owner_did FROM developer_clients WHERE client_id = \(clientID) LIMIT 1
            """
        )

        for try await row in rows {
            let (owner,) = try row.decode((String,).self)
            guard owner == ownerDID else {
                throw GatewayError(status: .forbidden, message: "Not authorized for this client", code: "forbidden")
            }
            return
        }

        throw GatewayError(status: .notFound, message: "Gateway client not found", code: "client_not_found")
    }

    // MARK: - Row mapping

    private func decodeClientRecord(from row: PostgresRow) throws -> DeveloperClientRecord {
        let (
            clientID,
            ownerDID,
            displayName,
            isOfficial,
            billingStatus,
            stripeCustomerID,
            dailyRequestLimit,
            createdAt
        ) = try row.decode(
            (
                String,
                String,
                String?,
                Bool,
                String,
                String?,
                Int32,
                Date
            ).self
        )

        return DeveloperClientRecord(
            clientID: clientID,
            ownerDID: ownerDID,
            displayName: displayName,
            isOfficial: isOfficial,
            billingStatus: billingStatus,
            stripeCustomerID: stripeCustomerID,
            dailyRequestLimit: dailyRequestLimit == Int32.max ? Int.max : Int(dailyRequestLimit),
            createdAt: formatTimestamp(createdAt)
        )
    }

    private func decodeApiKeyRecord(from row: PostgresRow) throws -> DeveloperApiKeyRecord {
        let (keyID, clientID, keyHash, label, createdAt, revokedAt) = try row.decode(
            (String, String, String, String?, Date, Date?).self
        )
        return DeveloperApiKeyRecord(
            keyID: keyID,
            clientID: clientID,
            keyHash: keyHash,
            label: label,
            createdAt: formatTimestamp(createdAt),
            revokedAt: revokedAt.map(formatTimestamp)
        )
    }

    private func formatTimestamp(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private func query(_ query: PostgresQuery) async throws -> PostgresRowSequence {
        do {
            return try await pool.query(query, logger: logger)
        } catch {
            throw mapDatabaseError(error)
        }
    }

    private func mapDatabaseError(
        _ error: Error,
        conflictMessage: String = "Conflict",
        conflictCode: String = "conflict"
    ) -> Error {
        if let gateway = error as? GatewayError {
            return gateway
        }
        let message = String(describing: error)
        if message.contains("duplicate key") || message.contains("23505") {
            return GatewayError(status: .conflict, message: conflictMessage, code: conflictCode)
        }
        logger.error("Developer store database error", metadata: ["error": .string(message)])
        return GatewayError(
            status: .internalServerError,
            message: "Database error",
            code: "database_error"
        )
    }
}

private func trimmedOptional(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}
