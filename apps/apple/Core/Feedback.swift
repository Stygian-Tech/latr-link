import Foundation

public struct FeedbackTag: Codable, Sendable, Hashable {
    public let label: String
    public let value: String
    public init(label: String, value: String) { self.label = label; self.value = value }
}
public struct FeedbackPhoto: Sendable {
    public let data: Data
    public let mimeType: String
    public let alt: String
    public init(data: Data, mimeType: String, alt: String) { self.data = data; self.mimeType = mimeType; self.alt = alt }
}
private struct BoardResponse: Decodable, Sendable {
    struct Board: Decodable, Sendable {
        struct Value: Decodable, Sendable { let tags: [FeedbackTag]? }
        let uri: String; let cid: String; let value: Value
    }
    let board: Board
}

public extension NativeLibrary {
    static var feedbackBoardURL: URL { URL(string: "https://userinput.app/s/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m?lang=en")! }
    private static var feedbackBoardAPI: URL { URL(string: "https://userinput.app/api/board/did:plc:qy5pluw2bsuq2x6albsgkvx3/3msgeiqdplp2m")! }
    private static var feedbackBoardURI: String { "at://did:plc:qy5pluw2bsuq2x6albsgkvx3/app.userinput.space/3msgeiqdplp2m" }
    func fetchFeedbackTags() async throws -> [FeedbackTag] { try await feedbackBoard().board.value.tags ?? [] }
    private func feedbackBoard() async throws -> BoardResponse {
        let data = try await http.send(URLRequest(url: Self.feedbackBoardAPI)).checked()
        let response = try JSONDecoder().decode(BoardResponse.self, from: data)
        guard response.board.uri == Self.feedbackBoardURI, !response.board.cid.isEmpty else { throw NativeError.invalidResponse }
        return response
    }
    func submitFeedback(title: String, body: String, tags: [String], photos: [FeedbackPhoto] = []) async throws -> URL {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines), body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title.utf16.count <= 200, body.utf16.count <= 10_000, photos.count <= 4,
              photos.allSatisfy({ $0.mimeType.hasPrefix("image/") && !$0.data.isEmpty && $0.data.count <= 10_000_000 }) else {
            throw NativeError.storage("Use a title of 1–200 characters, details up to 10,000 characters, and at most four photos (10 MB each).")
        }
        let board = try await feedbackBoard()
        let allowed = Set(board.board.value.tags?.map(\.value) ?? [])
        guard tags.allSatisfy({ allowed.contains($0) }) else { throw NativeError.storage("Choose a tag from the feedback board.") }
        return try await oauth.authenticated { [http] session, signer in
            let scopes = session.scope.split(separator: " ").map(String.init)
            guard scopes.contains(where: { $0.split(separator: "?").first == "include:app.userinput.authFull" || $0.hasPrefix("repo:app.userinput.discussion") }),
                  photos.isEmpty || scopes.contains("blob:*/*") else { throw NativeError.sessionExpired }
            var images: [[String: Any]] = []
            for photo in photos {
                let data = try await Self.pdsRequest("com.atproto.repo.uploadBlob", body: photo.data, mimeType: photo.mimeType, session: session, signer: signer, http: http)
                guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any], let blob = object["blob"] else { throw NativeError.invalidResponse }
                images.append(["image": blob, "alt": photo.alt])
            }
            let createdAt = ISO8601DateFormatter().string(from: Date())
            var record: [String: Any] = ["$type": "app.userinput.discussion", "space": ["uri": board.board.uri, "cid": board.board.cid], "title": title, "createdAt": createdAt]
            if !body.isEmpty { record["body"] = body }
            if !tags.isEmpty { record["tags"] = tags }
            if !images.isEmpty { record["images"] = images }
            let body = try JSONSerialization.data(withJSONObject: ["repo": session.did, "collection": "app.userinput.discussion", "record": record])
            let data = try await Self.pdsRequest("com.atproto.repo.createRecord", body: body, session: session, signer: signer, http: http)
            guard let response = try JSONSerialization.jsonObject(with: data) as? [String: Any], let uri = response["uri"] as? String, let cid = response["cid"] as? String,
                  uri.hasPrefix("at://\(session.did)/app.userinput.discussion/"), let rkey = uri.split(separator: "/").last else { throw NativeError.invalidResponse }
            let upvote: [String: Any] = ["repo": session.did, "collection": "app.userinput.upvote", "rkey": String(rkey),
                "record": ["$type": "app.userinput.upvote", "subject": ["uri": uri, "cid": cid], "createdAt": createdAt]]
            // Posting succeeded already; failure of the optional self-upvote must not invite duplicate feedback.
            _ = try? await Self.pdsRequest("com.atproto.repo.putRecord", body: JSONSerialization.data(withJSONObject: upvote), session: session, signer: signer, http: http)
            var result = URLComponents(string: "https://userinput.app")!
            result.path = "/d/\(session.did)/\(rkey)"; result.queryItems = [URLQueryItem(name: "lang", value: "en")]
            guard let url = result.url else { throw NativeError.invalidResponse }
            return url
        }
    }
    private static func pdsRequest(_ nsid: String, body: Data, mimeType: String = "application/json", session: NativeSession,
                                   signer: DPoPSigner, http: any NativeHTTPClient) async throws -> Data {
        let url = session.pdsURL.appending(path: "xrpc/\(nsid)")
        for attempt in 0..<3 {
            var request = URLRequest(url: url); request.httpMethod = "POST"; request.httpBody = body
            request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
            request.setValue("DPoP \(session.accessToken)", forHTTPHeaderField: "Authorization")
            request.setValue(try await signer.proof(method: "POST", url: url, accessToken: session.accessToken), forHTTPHeaderField: "DPoP")
            let result = try await http.send(request); await signer.update(from: result.response, for: url)
            let error = (try? JSONSerialization.jsonObject(with: result.data) as? [String: Any])?["error"] as? String
            if [400,401].contains(result.response.statusCode), ["use_dpop_nonce", "UseDpopNonce"].contains(error), result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil, attempt < 2 { continue }
            return try result.checked()
        }
        throw NativeError.invalidResponse
    }
}
