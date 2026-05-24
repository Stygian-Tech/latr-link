import Foundation

public struct RepoRecord<T: Codable & Sendable>: Codable, Sendable {
    public let uri: String
    public let cid: String
    public let value: T

    public init(uri: String, cid: String, value: T) {
        self.uri = uri
        self.cid = cid
        self.value = value
    }
}

public struct ListRecordsPage<T: Codable & Sendable>: Sendable {
    public let records: [RepoRecord<T>]
    public let cursor: String?

    public init(records: [RepoRecord<T>], cursor: String?) {
        self.records = records
        self.cursor = cursor
    }
}

public struct CreateRecordResult: Sendable {
    public let uri: String

    public init(uri: String) {
        self.uri = uri
    }
}

public struct PutRecordResult: Sendable {
    public let uri: String

    public init(uri: String) {
        self.uri = uri
    }
}

public protocol LatrRepoClient: Sendable {
    func listRecords<T: Codable & Sendable>(
        repo: String,
        collection: String,
        limit: Int?,
        cursor: String?
    ) async throws -> ListRecordsPage<T>

    func getRecord<T: Codable & Sendable>(
        repo: String,
        collection: String,
        rkey: String
    ) async throws -> RepoRecord<T>?

    func createRecord(
        repo: String,
        collection: String,
        rkey: String,
        record: some Encodable & Sendable
    ) async throws -> CreateRecordResult

    func putRecord(
        repo: String,
        collection: String,
        rkey: String,
        record: some Encodable & Sendable
    ) async throws -> PutRecordResult

    func deleteRecord(
        repo: String,
        collection: String,
        rkey: String
    ) async throws
}
