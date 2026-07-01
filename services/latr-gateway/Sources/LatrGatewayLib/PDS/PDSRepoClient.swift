import AsyncHTTPClient
import Foundation
import LatrKit
import NIOCore

public struct PDSRepositoryClient: RepositoryClient, Sendable {
    private let auth: AuthContext
    private let plcURL: String
    private let httpClient: HTTPClient
    private let upstreamPool: UpstreamProofPool
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
        self.upstreamPool = UpstreamProofPool(rawHeader: auth.upstreamDpopProof)
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

    private func isRecordNotFound(statusCode: Int, json: [String: Any]) -> Bool {
        if statusCode == 404 { return true }
        guard statusCode == 400 else { return false }

        let error = (json["error"] as? String) ?? ""
        let message = (json["message"] as? String) ?? ""
        if error == "RecordNotFound" { return true }
        return message.localizedCaseInsensitiveContains("could not locate record")
    }

    private func pdsFailureMessage(
        method: String,
        statusCode: Int,
        json: [String: Any],
        usedUpstreamProof: Bool
    ) -> String {
        var parts = ["PDS \(method) failed (\(statusCode))"]
        if let error = json["error"] as? String, !error.isEmpty {
            parts.append(error)
        }
        if let message = json["message"] as? String, !message.isEmpty {
            parts.append(message)
        }
        if !usedUpstreamProof {
            parts.append("missing upstream DPoP proof for this XRPC call")
        }
        return parts.joined(separator: ": ")
    }

    private func xrpcPost(method: String, body: [String: Any]) async throws -> [String: Any] {
        let requestURL: String
        let dpopProof: String
        let usedUpstreamProof: Bool
        let base = try await pdsBase()
        if let consumed = upstreamPool.consume(forXrpcMethod: method, httpMethod: "POST", pdsBase: base) {
            requestURL = consumed.url
            dpopProof = consumed.proof
            usedUpstreamProof = true
        } else {
            requestURL = "\(base)/xrpc/\(method)"
            dpopProof = auth.dpopProof
            usedUpstreamProof = false
        }

        guard URL(string: requestURL) != nil else {
            throw GatewayError(status: .badGateway, message: "Invalid PDS URL", code: "pds_error")
        }

        let bodyData = try JSONSerialization.data(withJSONObject: body)
        var request = HTTPClientRequest(url: requestURL)
        request.method = .POST
        request.headers.add(name: "Accept", value: "application/json")
        request.headers.add(name: "Content-Type", value: "application/json")
        request.headers.add(name: "Authorization", value: auth.authorizationHeader)
        request.headers.add(name: "DPoP", value: dpopProof)
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
                    message: pdsFailureMessage(
                        method: method,
                        statusCode: Int(response.status.code),
                        json: jsonObject,
                        usedUpstreamProof: usedUpstreamProof
                    ),
                    code: "pds_unauthorized"
                )
            case 403:
                throw GatewayError(
                    status: .forbidden,
                    message: pdsFailureMessage(
                        method: method,
                        statusCode: Int(response.status.code),
                        json: jsonObject,
                        usedUpstreamProof: usedUpstreamProof
                    ),
                    code: "pds_forbidden"
                )
            default:
                throw GatewayError(
                    status: .badGateway,
                    message: pdsFailureMessage(
                        method: method,
                        statusCode: Int(response.status.code),
                        json: jsonObject,
                        usedUpstreamProof: usedUpstreamProof
                    ),
                    code: "pds_error"
                )
            }
        }

        return jsonObject
    }

    private func xrpcGet(method: String, query: [String: String], useAuth: Bool) async throws -> [String: Any] {
        let xrpcBaseURL: String
        let dpopProof: String?
        let base = try await pdsBase()
        if useAuth {
            if let consumed = upstreamPool.consume(forXrpcMethod: method, httpMethod: "GET", pdsBase: base) {
                xrpcBaseURL = consumed.url
                dpopProof = consumed.proof
            } else {
                xrpcBaseURL = "\(base)/xrpc/\(method)"
                dpopProof = auth.dpopProof
            }
        } else {
            xrpcBaseURL = "\(base)/xrpc/\(method)"
            dpopProof = nil
        }

        var components = URLComponents(string: xrpcBaseURL)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else {
            throw GatewayError(status: .badGateway, message: "Invalid PDS URL", code: "pds_error")
        }

        var request = HTTPClientRequest(url: url.absoluteString)
        request.headers.add(name: "Accept", value: "application/json")
        if useAuth, let dpopProof {
            request.headers.add(name: "Authorization", value: auth.authorizationHeader)
            request.headers.add(name: "DPoP", value: dpopProof)
        }

        let response = try await httpClient.execute(request, timeout: .seconds(30))
        if response.status == .notFound { return [:] }

        let responseBody = try await response.body.collect(upTo: 2_097_152)
        let jsonObject = responseBody.readableBytes > 0
            ? (try? JSONSerialization.jsonObject(with: Data(buffer: responseBody)) as? [String: Any]) ?? [:]
            : [:]

        guard (200 ... 299).contains(response.status.code) else {
            if method == "com.atproto.repo.getRecord",
               isRecordNotFound(statusCode: Int(response.status.code), json: jsonObject)
            {
                return [:]
            }
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

        let json = try await xrpcGet(
            method: "com.atproto.repo.listRecords",
            query: query,
            useAuth: true
        )
        let rawRecords = json["records"] as? [[String: Any]] ?? []
        var records: [RepositoryRecord<Value>] = []
        records.reserveCapacity(rawRecords.count)
        for entry in rawRecords {
            guard let uri = entry["uri"] as? String,
                  let cid = entry["cid"] as? String,
                  let value = entry["value"]
            else { continue }
            do {
                let valueData = try JSONSerialization.data(withJSONObject: value)
                let decoded = try JSONDecoder().decode(Value.self, from: valueData)
                records.append(RepositoryRecord(uri: uri, cid: cid, value: decoded))
            } catch {
                print(
                    "Skipping undecodable PDS record \(uri) in \(collection.identifier): \(error)"
                )
            }
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
            query: ["repo": repository, "collection": collection.identifier, "rkey": key],
            useAuth: false
        )
        guard let uri = json["uri"] as? String,
              let cid = json["cid"] as? String,
              let value = json["value"]
        else {
            return nil
        }
        let valueData = try JSONSerialization.data(withJSONObject: value)
        do {
            let decoded = try JSONDecoder().decode(Value.self, from: valueData)
            return RepositoryRecord(uri: uri, cid: cid, value: decoded)
        } catch {
            throw GatewayError(
                status: .badGateway,
                message: "PDS record could not be decoded",
                code: "pds_record_decode"
            )
        }
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
