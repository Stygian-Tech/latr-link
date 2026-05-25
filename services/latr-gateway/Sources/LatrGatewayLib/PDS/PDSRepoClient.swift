import AsyncHTTPClient
import Foundation
import LatrKit
import NIOCore

public struct PDSRepositoryClient: RepositoryClient, Sendable {
    private let auth: AuthContext
    private let plcURL: String
    private let httpClient: HTTPClient
    private let fetchData: @Sendable (URL) async throws -> Data

    public init(
        auth: AuthContext,
        plcURL: String,
        httpClient: HTTPClient,
        fetchData: (@Sendable (URL) async throws -> Data)? = nil
    ) {
        self.auth = auth
        self.plcURL = plcURL
        self.httpClient = httpClient
        self.fetchData = fetchData ?? { url in
            var request = HTTPClientRequest(url: url.absoluteString)
            request.headers.add(name: "Accept", value: "application/json")
            let response = try await httpClient.execute(request, timeout: .seconds(15))
            guard response.status == .ok else {
                throw GatewayError(status: .badGateway, message: "PLC lookup failed", code: "pds_resolve")
            }
            let body = try await response.body.collect(upTo: 1_048_576)
            return Data(buffer: body)
        }
    }

    private var cachedPDSBase: LockStorage<String?> = .init(nil)

    private func pdsBase() async throws -> String {
        if let cached = cachedPDSBase.value { return cached }
        let resolved = try await resolvePDSBase(repoDID: auth.did, plcURL: plcURL, fetchData: fetchData)
        guard let base = resolved else {
            throw GatewayError(status: .badGateway, message: "Could not resolve viewer PDS", code: "pds_resolve")
        }
        cachedPDSBase.value = base
        return base
    }

    private func pdsDPOPProof() -> String {
        if let upstream = auth.upstreamDpopProof?.trimmingCharacters(in: .whitespacesAndNewlines),
           !upstream.isEmpty
        {
            return upstream
        }
        return auth.dpopProof
    }

    private func xrpcPost(method: String, body: [String: Any]) async throws -> [String: Any] {
        let base = try await pdsBase()
        guard let url = URL(string: "\(base)/xrpc/\(method)") else {
            throw GatewayError(status: .badGateway, message: "Invalid PDS URL", code: "pds_error")
        }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        var request = HTTPClientRequest(url: url.absoluteString)
        request.method = .POST
        request.headers.add(name: "Accept", value: "application/json")
        request.headers.add(name: "Content-Type", value: "application/json")
        request.headers.add(name: "Authorization", value: auth.authorizationHeader)
        request.headers.add(name: "DPoP", value: pdsDPOPProof())
        request.body = .bytes(bodyData)

        let response = try await httpClient.execute(request, timeout: .seconds(30))
        let responseBody = try await response.body.collect(upTo: 2_097_152)
        let jsonObject = responseBody.readableBytes > 0
            ? (try? JSONSerialization.jsonObject(with: Data(buffer: responseBody)) as? [String: Any]) ?? [:]
            : [:]

        guard (200 ... 299).contains(response.status.code) else {
            switch response.status.code {
            case 401:
                throw GatewayError(
                    status: .unauthorized,
                    message: "PDS rejected OAuth credentials for \(method)",
                    code: "pds_unauthorized"
                )
            case 403:
                throw GatewayError(
                    status: .forbidden,
                    message: "PDS rejected repo scope for \(method)",
                    code: "pds_forbidden"
                )
            default:
                throw GatewayError(
                    status: .badGateway,
                    message: "PDS \(method) failed (\(response.status.code))",
                    code: "pds_error"
                )
            }
        }

        return jsonObject
    }

    private func xrpcGet(method: String, query: [String: String]) async throws -> [String: Any] {
        let base = try await pdsBase()
        var components = URLComponents(string: "\(base)/xrpc/\(method)")!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else {
            throw GatewayError(status: .badGateway, message: "Invalid PDS URL", code: "pds_error")
        }

        var request = HTTPClientRequest(url: url.absoluteString)
        request.headers.add(name: "Accept", value: "application/json")
        request.headers.add(name: "Authorization", value: auth.authorizationHeader)
        request.headers.add(name: "DPoP", value: pdsDPOPProof())

        let response = try await httpClient.execute(request, timeout: .seconds(30))
        if response.status == .notFound { return [:] }

        let responseBody = try await response.body.collect(upTo: 2_097_152)
        guard (200 ... 299).contains(response.status.code) else {
            switch response.status.code {
            case 401:
                throw GatewayError(
                    status: .unauthorized,
                    message: "PDS rejected OAuth credentials for \(method)",
                    code: "pds_unauthorized"
                )
            case 403:
                throw GatewayError(
                    status: .forbidden,
                    message: "PDS rejected repo scope for \(method)",
                    code: "pds_forbidden"
                )
            default:
                throw GatewayError(
                    status: .badGateway,
                    message: "PDS \(method) failed (\(response.status.code))",
                    code: "pds_error"
                )
            }
        }

        guard responseBody.readableBytes > 0 else { return [:] }
        return (try JSONSerialization.jsonObject(with: Data(buffer: responseBody)) as? [String: Any]) ?? [:]
    }

    public func listRecords<Value>(
        in repository: String,
        collection: LexiconCollection,
        limit: Int?,
        startingAfter cursor: String?
    ) async throws -> RecordList<Value> where Value: Codable & Sendable {
        var query: [String: String] = [
            "repo": repository,
            "collection": collection.identifier,
            "limit": String(limit ?? 100),
        ]
        if let cursor { query["cursor"] = cursor }

        let json = try await xrpcGet(method: "com.atproto.repo.listRecords", query: query)
        let rawRecords = json["records"] as? [[String: Any]] ?? []
        let records: [RepositoryRecord<Value>] = try rawRecords.compactMap { entry in
            guard let uri = entry["uri"] as? String,
                  let cid = entry["cid"] as? String,
                  let value = entry["value"]
            else { return nil }
            let valueData = try JSONSerialization.data(withJSONObject: value)
            let decoded = try JSONDecoder().decode(Value.self, from: valueData)
            return RepositoryRecord(uri: uri, cid: cid, value: decoded)
        }
        let nextCursor = json["cursor"] as? String
        return RecordList(records: records, cursor: nextCursor)
    }

    public func record<Value>(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String
    ) async throws -> RepositoryRecord<Value>? where Value: Codable & Sendable {
        let json = try await xrpcGet(
            method: "com.atproto.repo.getRecord",
            query: ["repo": repository, "collection": collection.identifier, "rkey": key]
        )
        guard let uri = json["uri"] as? String,
              let cid = json["cid"] as? String,
              let value = json["value"]
        else {
            return nil
        }
        let valueData = try JSONSerialization.data(withJSONObject: value)
        let decoded = try JSONDecoder().decode(Value.self, from: valueData)
        return RepositoryRecord(uri: uri, cid: cid, value: decoded)
    }

    public func createRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String,
        value: some Encodable & Sendable
    ) async throws -> CreateRecordResponse {
        let recordData = try JSONEncoder().encode(AnyEncodable(value))
        let recordObject = try JSONSerialization.jsonObject(with: recordData) as? [String: Any] ?? [:]
        let json = try await xrpcPost(
            method: "com.atproto.repo.createRecord",
            body: [
                "repo": repository,
                "collection": collection.identifier,
                "rkey": key,
                "record": recordObject,
            ]
        )
        guard let uri = json["uri"] as? String else {
            throw GatewayError(status: .badGateway, message: "PDS createRecord missing uri", code: "pds_error")
        }
        return CreateRecordResponse(uri: uri)
    }

    public func updateRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String,
        value: some Encodable & Sendable
    ) async throws -> UpdateRecordResponse {
        let recordData = try JSONEncoder().encode(AnyEncodable(value))
        let recordObject = try JSONSerialization.jsonObject(with: recordData) as? [String: Any] ?? [:]
        let json = try await xrpcPost(
            method: "com.atproto.repo.putRecord",
            body: [
                "repo": repository,
                "collection": collection.identifier,
                "rkey": key,
                "record": recordObject,
            ]
        )
        guard let uri = json["uri"] as? String else {
            throw GatewayError(status: .badGateway, message: "PDS putRecord missing uri", code: "pds_error")
        }
        return UpdateRecordResponse(uri: uri)
    }

    public func deleteRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String
    ) async throws {
        _ = try await xrpcPost(
            method: "com.atproto.repo.deleteRecord",
            body: [
                "repo": repository,
                "collection": collection.identifier,
                "rkey": key,
            ]
        )
    }
}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void

    init(_ value: some Encodable) {
        self.encodeFunc = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}

private final class LockStorage<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T

    init(_ value: T) {
        self.stored = value
    }

    var value: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            stored = newValue
            lock.unlock()
        }
    }
}
