import Foundation
import CryptoKit

struct HTTPResult: Sendable {
    let data: Data
    let response: HTTPURLResponse
    func checked() throws -> Data {
        guard (200..<300).contains(response.statusCode) else {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw NativeError.http(response.statusCode, body?["message"] as? String ?? body?["error_description"] as? String ?? body?["error"] as? String ?? "Request failed")
        }
        return data
    }
}
protocol NativeHTTPClient: Sendable { func send(_ request: URLRequest) async throws -> HTTPResult }

/// OAuth metadata, bearer tokens and signed requests must never follow an unchecked redirect.
private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
struct SystemHTTPClient: NativeHTTPClient {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 45
        session = URLSession(configuration: configuration, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }
    func send(_ request: URLRequest) async throws -> HTTPResult {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NativeError.invalidResponse }
        return HTTPResult(data: data, response: http)
    }
}

actor DPoPSigner {
    private let key: P256.Signing.PrivateKey
    private var nonces: [String: String]
    init(privateKey: Data, nonces: [String: String] = [:]) throws { key = try P256.Signing.PrivateKey(rawRepresentation: privateKey); self.nonces = nonces }
    static func origin(_ url: URL) -> String {
        var parts = URLComponents(); parts.scheme = url.scheme?.lowercased(); parts.host = url.host?.lowercased()
        if let port = url.port, port != 443 { parts.port = port }
        return parts.string ?? ""
    }
    func proof(method: String, url: URL, accessToken: String? = nil) throws -> String {
        let point = key.publicKey.x963Representation
        let jwk = ["kty": "EC", "crv": "P-256", "x": Data(point[1..<33]).base64URL, "y": Data(point[33..<65]).base64URL]
        let header: [String: Any] = ["typ": "dpop+jwt", "alg": "ES256", "jwk": jwk]
        var target = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        target.query = nil; target.fragment = nil
        var payload: [String: Any] = ["jti": UUID().uuidString, "htm": method.uppercased(), "htu": target.string!, "iat": Int(Date().timeIntervalSince1970)]
        if let accessToken { payload["ath"] = Data(SHA256.hash(data: Data(accessToken.utf8))).base64URL }
        if let nonce = nonces[Self.origin(url)] { payload["nonce"] = nonce }
        let input = try JSONSerialization.data(withJSONObject: header, options: .sortedKeys).base64URL + "." + JSONSerialization.data(withJSONObject: payload, options: .sortedKeys).base64URL
        return try input + "." + key.signature(for: Data(input.utf8)).rawRepresentation.base64URL
    }
    func update(from response: HTTPURLResponse, for url: URL) {
        if let nonce = response.value(forHTTPHeaderField: "DPoP-Nonce"), !nonce.isEmpty { nonces[Self.origin(url)] = nonce }
    }
    func snapshot() -> [String: String] { nonces }
    func hasNonce(for url: URL) -> Bool { nonces[Self.origin(url)] != nil }
}

extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}

private struct AuthorizationMetadata: Decodable, Sendable {
    let issuer: URL
    let authorization_endpoint: URL
    let token_endpoint: URL
    let pushed_authorization_request_endpoint: URL
    let code_challenge_methods_supported: [String]
    let dpop_signing_alg_values_supported: [String]
    let token_endpoint_auth_methods_supported: [String]
    let response_types_supported: [String]
    let require_pushed_authorization_requests: Bool
    let client_id_metadata_document_supported: Bool
}
private struct ProtectedResource: Decodable, Sendable { let resource: URL; let authorization_servers: [URL] }
private struct PendingAuthorization: Codable, Sendable {
    let did: String
    let handle: String?
    let pds: URL
    let issuer: URL
    let tokenEndpoint: URL
    let verifier: String
    let state: String
    let key: Data
    let nonces: [String: String]
    let createdAt: Date
}
private struct TokenReply: Decodable, Sendable {
    let sub: String
    let access_token: String
    let refresh_token: String?
    let token_type: String
    let expires_in: Double
    let scope: String?
}

public actor OAuthClient {
    public let configuration: NativeConfiguration
    let vault: any SessionVault
    let http: any NativeHTTPClient
    private let lock: ProcessLock
    init(configuration: NativeConfiguration, vault: any SessionVault, http: any NativeHTTPClient, directory: URL) {
        self.configuration = configuration; self.vault = vault; self.http = http
        lock = ProcessLock(file: directory.appending(path: "account.lock"))
    }
    public func restoreSession() async throws -> NativeSession? {
        let session = try await vault.load()
        guard session == nil || session?.environment == configuration.environment else { throw NativeError.invalidIdentity }
        return session
    }
    public func signOut() async throws {
        try await lock.withLock { try await self.vault.clear() }
    }
    public func cancelAuthorization() async throws { try await lock.withLock { try await self.vault.savePendingAuthorization(nil) } }
    func publicPDSURL(for did: String) async throws -> URL { try await resolveIdentity(did).pds }
    public func authorizationURL(for handle: String) async throws -> URL {
        try await lock.withLock {
            let identity = try await self.resolveIdentity(handle)
            let protectedURL = identity.pds.appending(path: ".well-known/oauth-protected-resource")
            let resource = try JSONDecoder().decode(ProtectedResource.self, from: await self.fetch(protectedURL))
            guard let issuer = resource.authorization_servers.first else { throw NativeError.invalidIdentity }
            try Self.validateHTTPS(issuer)
            guard resource.resource.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == identity.pds.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) else { throw NativeError.invalidIdentity }
            let metadata = try JSONDecoder().decode(AuthorizationMetadata.self, from: await self.fetch(Self.metadataURL(for: issuer)))
            guard metadata.issuer == issuer, metadata.code_challenge_methods_supported.contains("S256"), metadata.dpop_signing_alg_values_supported.contains("ES256"),
                  metadata.token_endpoint_auth_methods_supported.contains("none"), metadata.response_types_supported.contains("code"),
                  metadata.require_pushed_authorization_requests, metadata.client_id_metadata_document_supported else { throw NativeError.invalidIdentity }
            for endpoint in [metadata.authorization_endpoint, metadata.token_endpoint, metadata.pushed_authorization_request_endpoint] { try Self.validateHTTPS(endpoint) }
            let verifier = P256.Signing.PrivateKey().rawRepresentation.base64URL
            let state = P256.Signing.PrivateKey().rawRepresentation.base64URL
            let key = P256.Signing.PrivateKey().rawRepresentation
            let signer = try DPoPSigner(privateKey: key)
            let fields = ["client_id": self.configuration.clientID.absoluteString, "redirect_uri": self.configuration.redirectURI.absoluteString,
                          "response_type": "code", "scope": NativeConfiguration.scopes, "state": state, "login_hint": identity.did,
                          "code_challenge": Data(SHA256.hash(data: Data(verifier.utf8))).base64URL, "code_challenge_method": "S256"]
            let par = try await self.oauthRequest(metadata.pushed_authorization_request_endpoint, fields: fields, signer: signer)
            guard let reply = try JSONSerialization.jsonObject(with: par) as? [String: Any], let requestURI = reply["request_uri"] as? String, !requestURI.isEmpty else { throw NativeError.invalidResponse }
            let pending = PendingAuthorization(did: identity.did, handle: identity.handle, pds: identity.pds, issuer: issuer, tokenEndpoint: metadata.token_endpoint,
                                               verifier: verifier, state: state, key: key, nonces: await signer.snapshot(), createdAt: Date())
            try await self.vault.savePendingAuthorization(JSONEncoder().encode(pending))
            var url = URLComponents(url: metadata.authorization_endpoint, resolvingAgainstBaseURL: false)!
            url.queryItems = [URLQueryItem(name: "client_id", value: self.configuration.clientID.absoluteString), URLQueryItem(name: "request_uri", value: requestURI)]
            guard let result = url.url else { throw NativeError.invalidResponse }
            return result
        }
    }
    public func completeAuthorization(callback: URL) async throws -> NativeSession {
        try await lock.withLock {
            guard let data = try await self.vault.pendingAuthorization() else { throw NativeError.invalidCallback }
            let pending = try JSONDecoder().decode(PendingAuthorization.self, from: data)
            guard Date().timeIntervalSince(pending.createdAt) < 600 else { throw NativeError.invalidCallback }
            let query = try Self.callbackParameters(callback, expected: self.configuration.redirectURI)
            guard query["state"] == pending.state, query["iss"] == pending.issuer.absoluteString else { throw NativeError.invalidCallback }
            // Only a matching callback consumes the transaction; unrelated deep links cannot
            // cancel an ongoing login. The process lock still prevents duplicate redemption.
            try await self.vault.savePendingAuthorization(nil)
            if query["error"] == "access_denied" { throw CancellationError() }
            guard query["error"] == nil, let code = query["code"], !code.isEmpty else { throw NativeError.invalidCallback }
            let signer = try DPoPSigner(privateKey: pending.key, nonces: pending.nonces)
            let response = try await self.oauthRequest(pending.tokenEndpoint, fields: ["grant_type": "authorization_code", "code": code,
                "code_verifier": pending.verifier, "client_id": self.configuration.clientID.absoluteString, "redirect_uri": self.configuration.redirectURI.absoluteString], signer: signer)
            let token = try JSONDecoder().decode(TokenReply.self, from: response)
            guard token.sub == pending.did, token.token_type.lowercased() == "dpop", !token.access_token.isEmpty,
                  let refresh = token.refresh_token, !refresh.isEmpty, token.expires_in > 0,
                  let scope = token.scope, scope.split(separator: " ").contains("atproto") else { throw NativeError.invalidIdentity }
            // Identity can migrate while the browser is open. Verify the returned DID still
            // delegates authorization to this issuer before persisting its access token.
            let current = try await self.resolveIdentity(token.sub)
            let resource = try JSONDecoder().decode(ProtectedResource.self, from: await self.fetch(current.pds.appending(path: ".well-known/oauth-protected-resource")))
            guard resource.resource.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == current.pds.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                  resource.authorization_servers.contains(pending.issuer) else { throw NativeError.invalidIdentity }
            let session = NativeSession(did: pending.did, handle: current.handle ?? pending.handle, environment: self.configuration.environment, pdsURL: current.pds,
                issuer: pending.issuer, tokenEndpoint: pending.tokenEndpoint, accessToken: token.access_token, refreshToken: refresh,
                scope: scope, expiresAt: Date().addingTimeInterval(token.expires_in), privateKey: pending.key,
                nonces: await signer.snapshot(), generation: UUID())
            try await self.vault.save(session)
            return session
        }
    }
    static func callbackParameters(_ callback: URL, expected: URL) throws -> [String: String] {
        guard var received = URLComponents(url: callback, resolvingAgainstBaseURL: false), let expectedParts = URLComponents(url: expected, resolvingAgainstBaseURL: false),
              received.fragment == nil else { throw NativeError.invalidCallback }
        let items = received.queryItems ?? []; received.query = nil
        guard received == expectedParts else { throw NativeError.invalidCallback }
        var result: [String: String] = [:]
        for item in items {
            guard result[item.name] == nil, let value = item.value else { throw NativeError.invalidCallback }
            result[item.name] = value
        }
        return result
    }
    func authenticated<Value: Sendable>(_ operation: @Sendable (NativeSession, DPoPSigner) async throws -> Value) async throws -> Value {
        try await lock.withLock {
            guard var session = try await self.vault.load(), session.environment == self.configuration.environment else { throw NativeError.notAuthenticated }
            let signer = try DPoPSigner(privateKey: session.privateKey, nonces: session.nonces)
            if session.expiresAt.timeIntervalSinceNow < 60 { session = try await self.refresh(session, signer: signer) }
            do {
                let value = try await operation(session, signer)
                session.nonces = await signer.snapshot(); try await self.vault.save(session)
                return value
            } catch {
                session.nonces = await signer.snapshot(); try? await self.vault.save(session)
                throw error
            }
        }
    }
    private func refresh(_ previous: NativeSession, signer: DPoPSigner) async throws -> NativeSession {
        let data = try await oauthRequest(previous.tokenEndpoint, fields: ["grant_type": "refresh_token", "refresh_token": previous.refreshToken,
            "client_id": configuration.clientID.absoluteString], signer: signer)
        let token = try JSONDecoder().decode(TokenReply.self, from: data)
        guard token.sub == previous.did, token.token_type.lowercased() == "dpop", !token.access_token.isEmpty, token.expires_in > 0,
              (token.scope ?? previous.scope).split(separator: " ").contains("atproto") else { throw NativeError.invalidIdentity }
        let session = NativeSession(did: previous.did, handle: previous.handle, environment: previous.environment, pdsURL: previous.pdsURL,
            issuer: previous.issuer, tokenEndpoint: previous.tokenEndpoint, accessToken: token.access_token, refreshToken: token.refresh_token ?? previous.refreshToken,
            scope: token.scope ?? previous.scope, expiresAt: Date().addingTimeInterval(token.expires_in), privateKey: previous.privateKey,
            nonces: await signer.snapshot(), generation: previous.generation)
        try await vault.save(session)
        return session
    }
    private func oauthRequest(_ url: URL, fields: [String: String], signer: DPoPSigner) async throws -> Data {
        for attempt in 0..<3 {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"; request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(Self.form(fields).utf8)
            request.setValue(try await signer.proof(method: "POST", url: url), forHTTPHeaderField: "DPoP")
            let result = try await http.send(request)
            await signer.update(from: result.response, for: url)
            let error = (try? JSONSerialization.jsonObject(with: result.data) as? [String: Any])?["error"] as? String
            if error == "invalid_grant" { throw NativeError.sessionExpired }
            if [400,401].contains(result.response.statusCode), error == "use_dpop_nonce", result.response.value(forHTTPHeaderField: "DPoP-Nonce") != nil, attempt < 2 { continue }
            return try result.checked()
        }
        throw NativeError.invalidResponse
    }
    static func form(_ values: [String: String]) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return values.keys.sorted().map { "\($0.addingPercentEncoding(withAllowedCharacters: allowed)!)=\(values[$0]!.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&")
    }
    private func fetch(_ url: URL) async throws -> Data { try Self.validateHTTPS(url); return try await http.send(URLRequest(url: url)).checked() }
    private func json(_ url: URL) async throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: await fetch(url)) as? [String: Any] else { throw NativeError.invalidResponse }
        return value
    }
    static func validateHTTPS(_ url: URL) throws {
        guard url.scheme == "https", let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.fragment == nil,
              host != "localhost", host != "127.0.0.1", host != "::1" else { throw NativeError.invalidIdentity }
    }
    static func metadataURL(for issuer: URL) throws -> URL {
        try validateHTTPS(issuer)
        guard var parts = URLComponents(url: issuer, resolvingAgainstBaseURL: false), parts.query == nil else { throw NativeError.invalidIdentity }
        parts.path = "/.well-known/oauth-authorization-server" + (parts.path == "/" ? "" : parts.path)
        guard let url = parts.url else { throw NativeError.invalidIdentity }
        return url
    }
    private func resolveIdentity(_ raw: String) async throws -> (did: String, handle: String?, pds: URL) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let name = trimmed.hasPrefix("did:") ? trimmed : trimmed.lowercased()
        let did: String
        if name.hasPrefix("did:") { did = name }
        else {
            var parts = URLComponents(string: "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle")!
            parts.queryItems = [URLQueryItem(name: "handle", value: name)]
            guard let resolved = try await json(parts.url!)["did"] as? String else { throw NativeError.invalidIdentity }
            did = resolved
        }
        let documentURL = try Self.didDocumentURL(did)
        let document = try await json(documentURL)
        guard document["id"] as? String == did else { throw NativeError.invalidIdentity }
        if !name.hasPrefix("did:") {
            guard (document["alsoKnownAs"] as? [String])?.contains("at://\(name.lowercased())") == true else { throw NativeError.invalidIdentity }
        }
        guard let services = document["service"] as? [[String: Any]], let service = services.first(where: {
            ($0["id"] as? String == "#atproto_pds" || $0["id"] as? String == "\(did)#atproto_pds") && $0["type"] as? String == "AtprotoPersonalDataServer"
        }), let endpoint = service["serviceEndpoint"] as? String, let pds = URL(string: endpoint) else { throw NativeError.invalidIdentity }
        try Self.validateHTTPS(pds)
        // A DID document's handle alias is display-only here; authorizations remain DID-bound.
        let alias = (document["alsoKnownAs"] as? [String])?.first(where: { $0.hasPrefix("at://") }).map { String($0.dropFirst(5)) }
        return (did, name.hasPrefix("did:") ? alias : name, pds)
    }
    static func didDocumentURL(_ did: String) throws -> URL {
        if did.hasPrefix("did:plc:") {
            let identifier = String(did.dropFirst(8))
            guard !identifier.isEmpty, identifier.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { throw NativeError.invalidIdentity }
            return URL(string: "https://plc.directory/\(did)")!
        }
        guard did.hasPrefix("did:web:") else { throw NativeError.invalidIdentity }
        let components = did.dropFirst(8).split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard let host = components.first?.removingPercentEncoding, !host.isEmpty, !host.contains("/"), !host.contains("@") else { throw NativeError.invalidIdentity }
        guard var url = URL(string: "https://\(host)"), url.query == nil, url.fragment == nil, url.path.isEmpty else { throw NativeError.invalidIdentity }
        for component in components.dropFirst() {
            guard let decoded = component.removingPercentEncoding, !decoded.isEmpty, decoded != ".", decoded != "..", !decoded.contains("/") else { throw NativeError.invalidIdentity }
            url.append(path: decoded)
        }
        if components.count == 1 { url.append(path: ".well-known") }
        url.append(path: "did.json"); try validateHTTPS(url)
        return url
    }
}
