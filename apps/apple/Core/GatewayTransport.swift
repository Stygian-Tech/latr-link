import Foundation
import LatrKit

public struct NativeProofSpec: Sendable, Codable, Equatable {
    public let nsid: String
    public let method: String
    public let count: Int
    init(_ nsid: String, _ method: String, _ count: Int) { self.nsid = nsid; self.method = method; self.count = count }
}

public enum NativeProofPlan {
    public static func specs(for method: LatrXRPCMethod) -> [NativeProofSpec] {
        let list = "com.atproto.repo.listRecords", get = "com.atproto.repo.getRecord", write = "com.atproto.repo.applyWrites"
        switch method {
        case .listBookmarks: return [.init(list,"GET",9)]
        case .listTags: return [.init(list,"GET",1)]
        case .getBookmark: return [.init(list,"GET",8),.init(get,"GET",1)]
        case .saveBookmark: return [.init(list,"GET",8),.init(get,"GET",2),.init(write,"POST",1)]
        case .setBookmarkTags: return [.init(get,"GET",3),.init(write,"POST",1)]
        case .renameBookmarkTag, .deleteBookmarkTag: return [.init(list,"GET",1),.init(write,"POST",1)]
        case .setBookmarkState, .deleteBookmark: return [.init(get,"GET",2),.init(write,"POST",1)]
        case .syncBookmarkMetadata: return [.init(list,"GET",9),.init(write,"POST",1)]
        case .migrateBookmarks: return [.init(list,"GET",40),.init(get,"GET",25),.init(write,"POST",25)]
        case .getOpenGraph, .resolveURL, .authProbe: return [.init("com.atproto.server.getSession","GET",1)]
        default: return []
        }
    }
}

struct NativeGatewayTransport: LatrXRPCTransport {
    let oauth: OAuthClient
    let configuration: NativeConfiguration
    let http: any NativeHTTPClient
    var expectedDID: String? = nil
    // LTR-19 tracks the hosted gateway's PATCH-only state route; LatrKit stays canonical POST.
    static func effectiveVerb(for method: LatrXRPCMethod) -> String { method == .setBookmarkState ? "PATCH" : method.verb }
    func send(method: LatrXRPCMethod, parameters: [URLQueryItem], body: Data?) async throws -> Data {
        try await oauth.authenticated { session, signer in
            guard expectedDID == nil || expectedDID == session.did else { throw NativeError.invalidIdentity }
            var components = URLComponents(url: configuration.gatewayURL.appending(path: "xrpc/\(method.nsid)"), resolvingAgainstBaseURL: false)!
            components.queryItems = parameters.isEmpty ? nil : parameters
            guard let url = components.url else { throw NativeError.invalidSubject }
            let verb = Self.effectiveVerb(for: method)
            for attempt in 0..<3 {
                let pool = try await proofPool(method: method, session: session, signer: signer)
                var request = URLRequest(url: url)
                request.httpMethod = verb
                request.httpBody = body
                if method == .migrateBookmarks {
                    var object = try body.map { try JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
                    object?["upstreamDpopProof"] = pool
                    request.httpBody = try JSONSerialization.data(withJSONObject: object ?? [:])
                } else if !pool.isEmpty { request.setValue(pool, forHTTPHeaderField: "X-ATProto-Upstream-DPoP") }
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                if request.httpBody != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
                request.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "X-Latr-User-Authorization")
                // htu binds the externally visible same-origin proxy URL, matching web clients.
                request.setValue(try await signer.proof(method: verb, url: url, accessToken: session.accessToken), forHTTPHeaderField: "X-Latr-User-DPoP")
                let result = try await http.send(request)
                await signer.update(from: result.response, for: url)
                let error = (try? JSONSerialization.jsonObject(with: result.data) as? [String: Any])?["error"] as? String
                if [400, 401].contains(result.response.statusCode), error == "use_dpop_nonce",
                   result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil, attempt < 2 { continue }
                return try result.checked()
            }
            throw NativeError.invalidResponse
        }
    }
    private func proofPool(method: LatrXRPCMethod, session: NativeSession, signer: DPoPSigner) async throws -> String {
        var proofs: [String] = []
        for spec in NativeProofPlan.specs(for: method) {
            for _ in 0..<spec.count {
                try Task.checkCancellation()
                let target = session.pdsURL.appending(path: "xrpc/\(spec.nsid)")
                if proofs.isEmpty, try await primeByReading(session: session, signer: signer) {
                    proofs.append(try await signer.proof(method: spec.method, url: target, accessToken: session.accessToken))
                    continue
                }
                // Match the web proof pool: each invalid write probe obtains the next nonce.
                // The empty body cannot create, update, or delete a PDS record.
                let probeNSID = spec.method == "GET" ? "com.atproto.repo.createRecord" : spec.nsid
                let probeURL = session.pdsURL.appending(path: "xrpc/\(probeNSID)")
                for attempt in 0..<3 {
                    var probe = URLRequest(url: probeURL)
                    probe.httpMethod = "POST"; probe.httpBody = Data("{}".utf8)
                    probe.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    probe.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
                    probe.setValue(try await signer.proof(method: "POST", url: probeURL, accessToken: session.accessToken), forHTTPHeaderField: "DPoP")
                    let result = try await http.send(probe)
                    await signer.update(from: result.response, for: probeURL)
                    if result.response.statusCode == 401, result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil, attempt < 2 { continue }
                    guard await signer.hasNonce(for: probeURL) else { throw NativeError.invalidResponse }
                    // Only the expected schema rejection or nonce challenge can prime a pool.
                    guard [400,401,422].contains(result.response.statusCode) else { _ = try result.checked(); throw NativeError.invalidResponse }
                    break
                }
                proofs.append(try await signer.proof(method: spec.method, url: target, accessToken: session.accessToken))
            }
        }
        return proofs.joined(separator: ",")
    }
    private func primeByReading(session: NativeSession, signer: DPoPSigner) async throws -> Bool {
        var parts = URLComponents(url: session.pdsURL.appending(path: "xrpc/com.atproto.repo.listRecords"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "repo", value: session.did), URLQueryItem(name: "collection", value: "community.lexicon.bookmarks.bookmark"), URLQueryItem(name: "limit", value: "1")]
        let url = parts.url!
        for attempt in 0..<3 {
            var request = URLRequest(url: url)
            request.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
            request.setValue(try await signer.proof(method: "GET", url: url, accessToken: session.accessToken), forHTTPHeaderField: "DPoP")
            let result = try await http.send(request)
            await signer.update(from: result.response, for: url)
            let error = (try? JSONSerialization.jsonObject(with: result.data) as? [String: Any])?["error"] as? String
            if [400,401].contains(result.response.statusCode), error == "use_dpop_nonce", result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil, attempt < 2 { continue }
            _ = try result.checked()
            return result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil
        }
        return false
    }
}
