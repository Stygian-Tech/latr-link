import Foundation
import SQLite3
import Security
import Darwin

/// SQLite owns interprocess serialization. Connections are opened inside each actor operation,
/// so no opaque sqlite pointers escape isolation or survive an actor suspension.
public actor NativeStore {
    public let directory: URL
    private let databaseURL: URL
    public init(directory: URL) throws {
        self.directory = directory
        databaseURL = directory.appending(path: "library.sqlite3")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Self.withDatabase(databaseURL) { db in
            try Self.execute(db, "PRAGMA journal_mode=WAL")
            try Self.execute(db, "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, payload BLOB NOT NULL)")
        }
    }
    public func value<Value: Decodable & Sendable>(_ type: Value.Type, for key: String) throws -> Value? {
        try Self.withDatabase(databaseURL) { db in try Self.read(db, key: key).map { try JSONDecoder().decode(type, from: $0) } }
    }
    public func set<Value: Encodable & Sendable>(_ value: Value, for key: String) throws {
        let data = try JSONEncoder().encode(value)
        try Self.withDatabase(databaseURL) { try Self.write($0, key: key, data: data) }
    }
    public func remove(_ key: String) throws {
        try Self.withDatabase(databaseURL) { db in
            let statement = try Self.prepare(db, "DELETE FROM records WHERE key = ?")
            defer { sqlite3_finalize(statement) }
            Self.bind(key, at: 1, in: statement)
            guard sqlite3_step(statement) == SQLITE_DONE else { throw Self.failure(db) }
        }
    }
    public func pendingSaves(environment: NativeEnvironment) throws -> [PendingSave] {
        try Self.withDatabase(databaseURL) { db in
            let statement = try Self.prepare(db, "SELECT payload FROM records WHERE key LIKE 'pending:%' ORDER BY key")
            defer { sqlite3_finalize(statement) }
            var saves: [PendingSave] = []
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { break }
                guard result == SQLITE_ROW else { throw Self.failure(db) }
                let save = try JSONDecoder().decode(PendingSave.self, from: Self.data(statement))
                if save.environment == environment { saves.append(save) }
            }
            return saves.sorted { $0.createdAt < $1.createdAt }
        }
    }
    public func savePending(_ save: PendingSave) throws { try set(save, for: "pending:\(save.id.uuidString)") }
    public func removePending(id: UUID) throws { try remove("pending:\(id.uuidString)") }
    func updatePending(id: UUID, subject: String, tags: [String], adoptingDID: String? = nil) throws {
        let subject = try SharedLinkParser.validatedSubject(subject)
        let tags = try TagValidation.normalize(tags)
        try Self.withDatabase(databaseURL) { db in
            try Self.execute(db, "BEGIN IMMEDIATE")
            do {
                let key = "pending:\(id.uuidString)"
                guard let data = try Self.read(db, key: key) else { throw NativeError.storage("Pending save no longer exists.") }
                var save = try JSONDecoder().decode(PendingSave.self, from: data)
                if let adoptingDID {
                    guard save.did == nil || save.did == adoptingDID else { throw NativeError.invalidIdentity }
                    save.did = adoptingDID
                }
                save.subject = subject; save.tags = tags; save.lastError = nil
                try Self.write(db, key: key, data: JSONEncoder().encode(save))
                try Self.execute(db, "COMMIT")
            } catch { try? Self.execute(db, "ROLLBACK"); throw error }
        }
    }
    private static func withDatabase<T>(_ url: URL, operation: (OpaquePointer) throws -> T) throws -> T {
        var database: OpaquePointer?
        guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let database else {
            if let database { sqlite3_close(database) }
            throw NativeError.storage("Could not open the local library.")
        }
        defer { sqlite3_close(database) }
        sqlite3_busy_timeout(database, 2000)
        return try operation(database)
    }
    private static func failure(_ db: OpaquePointer) -> NativeError { .storage(String(cString: sqlite3_errmsg(db))) }
    private static func execute(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure(db) }
    }
    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw failure(db) }
        return statement
    }
    private static func bind(_ value: String, at index: Int32, in statement: OpaquePointer) {
        // SQLITE_TRANSIENT asks SQLite to copy Swift's temporary UTF-8 buffer before returning.
        _ = value.withCString { sqlite3_bind_text(statement, index, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
    }
    private static func data(_ statement: OpaquePointer) -> Data {
        let size = Int(sqlite3_column_bytes(statement, 0))
        guard size > 0, let pointer = sqlite3_column_blob(statement, 0) else { return Data() }
        return Data(bytes: pointer, count: size)
    }
    private static func read(_ db: OpaquePointer, key: String) throws -> Data? {
        let statement = try prepare(db, "SELECT payload FROM records WHERE key = ?")
        defer { sqlite3_finalize(statement) }
        bind(key, at: 1, in: statement)
        let result = sqlite3_step(statement)
        if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW else { throw failure(db) }
        return data(statement)
    }
    private static func write(_ db: OpaquePointer, key: String, data: Data) throws {
        let statement = try prepare(db, "INSERT INTO records(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload")
        defer { sqlite3_finalize(statement) }
        bind(key, at: 1, in: statement)
        _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw failure(db) }
    }
}

struct ProcessLock: Sendable {
    let file: URL
    func withLock<Value: Sendable>(timeout: Duration = .seconds(2), _ operation: @Sendable () async throws -> Value) async throws -> Value {
        let fd = Darwin.open(file.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw NativeError.storage("Could not coordinate shared account access.") }
        defer { Darwin.close(fd) }
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EAGAIN else { throw NativeError.storage("Shared account locking failed.") }
            guard ContinuousClock.now < deadline else { throw NativeError.busy }
            try await Task.sleep(for: .milliseconds(40))
        }
        defer { flock(fd, LOCK_UN) }
        try Task.checkCancellation()
        return try await operation()
    }
}

protocol SessionVault: Sendable {
    func load() async throws -> NativeSession?
    func save(_ session: NativeSession) async throws
    func clear() async throws
    func savePendingAuthorization(_ data: Data?) async throws
    func pendingAuthorization() async throws -> Data?
}

actor KeychainSessionVault: SessionVault {
    private struct Envelope: Codable { let version: Int; let session: NativeSession }
    private let group: String
    private let service: String
    init(configuration: NativeConfiguration) { group = configuration.keychainAccessGroup; service = "link.latr.native.\(configuration.environment.rawValue)" }
    func load() throws -> NativeSession? {
        guard let data = try read("session") else { return nil }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.version == 1 else { throw NativeError.storage("This account was saved by an unsupported app version.") }
        return envelope.session
    }
    func save(_ session: NativeSession) throws { try write(JSONEncoder().encode(Envelope(version: 1, session: session)), account: "session") }
    func clear() throws { try remove("session"); try remove("authorization") }
    func savePendingAuthorization(_ data: Data?) throws { if let data { try write(data, account: "authorization") } else { try remove("authorization") } }
    func pendingAuthorization() throws -> Data? { try read("authorization") }
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
    }
    private func read(_ account: String) throws -> Data? {
        var query = query(account); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw failure(status) }
        return data
    }
    private func write(_ data: Data, account: String) throws {
        let query = query(account)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var entry = query; entry[kSecValueData as String] = data; entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(entry as CFDictionary, nil)
            guard added == errSecSuccess else { throw failure(added) }
        } else if status != errSecSuccess { throw failure(status) }
    }
    private func remove(_ account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }
    }
    private func failure(_ status: OSStatus) -> NativeError { .storage("Secure account storage is unavailable (\(status)). Check the app's signing and shared Keychain entitlement.") }
}
