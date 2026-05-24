import Foundation
import LatrGatewayLib

final class FakeRepoClient: LatrRepoClient, @unchecked Sendable {
    private var store: [String: (uri: String, cid: String, json: Data)] = [:]

    func snapshotKeys() -> [String] { Array(store.keys) }

    private func storeKey(collection: String, rkey: String) -> String {
        "\(collection):\(rkey)"
    }

    func listRecords<T>(
        repo: String,
        collection: String,
        limit: Int?,
        cursor: String?
    ) async throws -> ListRecordsPage<T> where T: Decodable, T: Encodable, T: Sendable {
        let prefix = "\(collection):"
        let all: [RepoRecord<T>] = try store
            .filter { $0.key.hasPrefix(prefix) }
            .map { _, entry in
                let decoded = try JSONDecoder().decode(T.self, from: entry.json)
                return RepoRecord(uri: entry.uri, cid: entry.cid, value: decoded)
            }

        let start = cursor.flatMap { Int($0) } ?? 0
        let pageLimit = limit ?? 100
        let page = Array(all.dropFirst(start).prefix(pageLimit))
        let next = start + pageLimit < all.count ? String(start + pageLimit) : nil
        return ListRecordsPage(records: page, cursor: next)
    }

    func getRecord<T>(
        repo: String,
        collection: String,
        rkey: String
    ) async throws -> RepoRecord<T>? where T: Decodable, T: Encodable, T: Sendable {
        guard let entry = store[storeKey(collection: collection, rkey: rkey)] else { return nil }
        let decoded = try JSONDecoder().decode(T.self, from: entry.json)
        return RepoRecord(uri: entry.uri, cid: entry.cid, value: decoded)
    }

    func createRecord(
        repo: String,
        collection: String,
        rkey: String,
        record: some Encodable & Sendable
    ) async throws -> CreateRecordResult {
        let uri = "at://\(repo)/\(collection)/\(rkey)"
        let json = try JSONEncoder().encode(record)
        store[storeKey(collection: collection, rkey: rkey)] = (uri: uri, cid: "bafytest", json: json)
        return CreateRecordResult(uri: uri)
    }

    func putRecord(
        repo: String,
        collection: String,
        rkey: String,
        record: some Encodable & Sendable
    ) async throws -> PutRecordResult {
        let uri = "at://\(repo)/\(collection)/\(rkey)"
        let json = try JSONEncoder().encode(record)
        store[storeKey(collection: collection, rkey: rkey)] = (uri: uri, cid: "bafytest", json: json)
        return PutRecordResult(uri: uri)
    }

    func deleteRecord(repo: String, collection: String, rkey: String) async throws {
        store.removeValue(forKey: storeKey(collection: collection, rkey: rkey))
    }

    func hasRecord(collection: String, rkey: String) -> Bool {
        store[storeKey(collection: collection, rkey: rkey)] != nil
    }
}
