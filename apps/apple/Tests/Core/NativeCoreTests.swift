import Foundation
import Testing
import CryptoKit
@testable import LatrNativeCore

@Test func parsesSubjects() throws {
    #expect(SharedLinkParser.subjects(in: "Read https://example.com/a and https://example.com/b") == ["https://example.com/a", "https://example.com/b"])
    #expect(SharedLinkParser.subjects(in: "javascript:alert(1)").isEmpty)
}

private let configuration = NativeConfiguration(environment: .testing, appGroupIdentifier: "test", keychainAccessGroup: "test")
private func fixture(_ name: String) throws -> Data {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    return try Data(contentsOf: root.appending(path: "packages/native-contracts/\(name).v1.json"))
}
private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "latr-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}
private func response(_ request: URLRequest, _ body: [String: Any], status: Int = 200, nonce: String? = nil) throws -> HTTPResult {
    HTTPResult(data: try JSONSerialization.data(withJSONObject: body), response: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nonce.map { ["DPoP-Nonce": $0] })!)
}
private func jwtObject(_ jwt: String, index: Int) throws -> [String: Any] {
    let component = String(jwt.split(separator: ".")[index]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let data = try #require(Data(base64Encoded: component + String(repeating: "=", count: (4 - component.count % 4) % 4)))
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
private struct BehaviorFixture: Decodable {
    struct Tag: Decodable { let input: [String]; let expected: [String]?; let error: Bool? }
    struct Subject: Decodable { let input: String; let expected: [String] }
    let tagCases: [Tag]; let subjectCases: [Subject]; let bookmarkPage: LatrListBookmarksOutput
}
@Test func sharedBehaviorFixtures() throws {
    let data = try JSONDecoder().decode(BehaviorFixture.self, from: fixture("behavior"))
    for test in data.tagCases {
        if test.error == true { #expect(throws: (any Error).self) { try TagValidation.normalize(test.input) } }
        else { #expect(try TagValidation.normalize(test.input).map { Data($0.utf8) } == test.expected?.map { Data($0.utf8) }) }
    }
    for test in data.subjectCases { #expect(SharedLinkParser.subjects(in: test.input) == test.expected) }
    #expect(data.bookmarkPage.bookmarks.first?.isArchived == true)
    #expect(data.bookmarkPage.cursor == "opaque-next-page")
}
@Test func sharedWireFixtures() throws {
    struct Contracts: Decodable {
        struct Environment: Decodable { struct IOS: Decodable { let client_id: String; let redirect_uris: [String] }; let name: String; let proxyBase: String; let ios: IOS }
        struct Plan: Decodable { struct Spec: Decodable { let xrpcMethod: String; let httpMethod: String; let count: Int }; let nsid: String; let method: String; let canonicalMethod: String; let specs: [Spec] }
        let scope: String; let environments: [Environment]; let proofPlans: [Plan]
    }
    let data = try JSONDecoder().decode(Contracts.self, from: fixture("contracts"))
    #expect(data.scope == NativeConfiguration.scopes)
    for environment in data.environments {
        let config = NativeConfiguration(environment: environment.name == "production" ? .production : .testing, appGroupIdentifier: "test", keychainAccessGroup: "test")
        #expect(config.clientID.absoluteString == environment.ios.client_id)
        #expect(environment.ios.redirect_uris == [config.redirectURI.absoluteString])
        #expect(config.gatewayURL.absoluteString == environment.proxyBase)
    }
    for plan in data.proofPlans {
        let method = try #require(LatrXRPCMethod.all.first { $0.nsid == plan.nsid })
        #expect(method.verb == plan.canonicalMethod)
        #expect(NativeGatewayTransport.effectiveVerb(for: method) == plan.method)
        #expect(NativeProofPlan.specs(for: method) == plan.specs.map { NativeProofSpec($0.xrpcMethod, $0.httpMethod, $0.count) })
    }
}
@Test func tagLimitsAndByteIdentity() throws {
    #expect(try TagValidation.normalize(["e\u{301}", "é"]).count == 2)
    #expect(try TagValidation.normalize(Array(repeating: "x", count: 101)) == ["x"])
    #expect(throws: (any Error).self) { try TagValidation.normalize((0..<101).map { "tag\($0)" }) }
    #expect(throws: (any Error).self) { try TagValidation.normalize([String(repeating: "x", count: 65)]) }
    #expect(try TagValidation.normalize([String(repeating: "👨‍👩‍👧‍👦", count: 20)]).count == 1)
    #expect(throws: (any Error).self) { try TagValidation.normalize([String(repeating: "👨‍👩‍👧‍👦", count: 30)]) }
}
@Test(arguments: ["link.latr.testing:/wrong?state=x", "link.latr:/oauth/ios?state=x", "link.latr.testing:/oauth/ios?state=a&state=b", "link.latr.testing:/oauth/ios?code=x#fragment"])
func rejectsMalformedCallbacks(_ raw: String) throws {
    #expect(throws: NativeError.invalidCallback) { try OAuthClient.callbackParameters(URL(string: raw)!, expected: configuration.redirectURI) }
}
@Test func identityURLValidation() throws {
    #expect(try OAuthClient.didDocumentURL("did:web:example.com").absoluteString == "https://example.com/.well-known/did.json")
    #expect(try OAuthClient.didDocumentURL("did:web:example.com:users:alice").absoluteString == "https://example.com/users/alice/did.json")
    #expect(throws: (any Error).self) { try OAuthClient.didDocumentURL("did:web:%2Fbad") }
    #expect(throws: (any Error).self) { try OAuthClient.didDocumentURL("did:web:example.com:..:bad") }
    #expect(try OAuthClient.metadataURL(for: URL(string: "https://auth.example.com/tenant")!).absoluteString == "https://auth.example.com/.well-known/oauth-authorization-server/tenant")
}
@Test func dpopCryptographicBinding() async throws {
    let key = P256.Signing.PrivateKey()
    let signer = try DPoPSigner(privateKey: key.rawRepresentation)
    let url = URL(string: "https://testing.latr.link/api/latr-gateway/xrpc/example?limit=1#fragment")!
    let first = try await signer.proof(method: "PATCH", url: url, accessToken: "token")
    let second = try await signer.proof(method: "PATCH", url: url, accessToken: "token")
    let claims = try jwtObject(first, index: 1)
    #expect(claims["htu"] as? String == "https://testing.latr.link/api/latr-gateway/xrpc/example")
    #expect(claims["htm"] as? String == "PATCH")
    #expect(claims["ath"] as? String == Data(SHA256.hash(data: Data("token".utf8))).base64URL)
    #expect(try jwtObject(second, index: 1)["jti"] as? String != claims["jti"] as? String)
    let pieces = first.split(separator: ".")
    let signatureText = String(pieces[2]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let signatureData = try #require(Data(base64Encoded: signatureText + String(repeating: "=", count: (4 - signatureText.count % 4) % 4)))
    #expect(try key.publicKey.isValidSignature(P256.Signing.ECDSASignature(rawRepresentation: signatureData), for: Data("\(pieces[0]).\(pieces[1])".utf8)))
}

private actor OAuthFixtureHTTP: NativeHTTPClient {
    var state = ""
    var refreshCalls = 0
    var tokenCalls = 0
    let returnedDID: String
    let failRefresh: Bool
    let changedIssuer: Bool
    let invalidGrant: Bool
    init(returnedDID: String = "did:plc:nativepreview", failRefresh: Bool = false, changedIssuer: Bool = false, invalidGrant: Bool = false) {
        self.returnedDID = returnedDID; self.failRefresh = failRefresh; self.changedIssuer = changedIssuer; self.invalidGrant = invalidGrant
    }
    func send(_ request: URLRequest) async throws -> HTTPResult {
        let url = request.url!
        if url.path.contains("resolveHandle") { return try response(request, ["did": "did:plc:nativepreview"]) }
        if url.host == "plc.directory" { return try response(request, ["id": "did:plc:nativepreview", "alsoKnownAs": ["at://reader.example.com"], "service": [["id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": "https://pds.example.com"]]]) }
        if url.path.contains("oauth-protected-resource") { return try response(request, ["resource": "https://pds.example.com", "authorization_servers": [changedIssuer && tokenCalls > 0 ? "https://changed.example.com" : "https://pds.example.com"]]) }
        if url.path.contains("oauth-authorization-server") { return try response(request, ["issuer": "https://pds.example.com", "authorization_endpoint": "https://pds.example.com/oauth/authorize", "token_endpoint": "https://pds.example.com/oauth/token", "pushed_authorization_request_endpoint": "https://pds.example.com/oauth/par", "code_challenge_methods_supported": ["S256"], "dpop_signing_alg_values_supported": ["ES256"], "token_endpoint_auth_methods_supported": ["none"], "response_types_supported": ["code"], "require_pushed_authorization_requests": true, "client_id_metadata_document_supported": true]) }
        if url.path == "/oauth/par" {
            let body = String(data: request.httpBody!, encoding: .utf8)!
            let items = URLComponents(string: "https://example.com/?" + body)!.queryItems!
            state = items.first { $0.name == "state" }!.value!
            #expect(items.first { $0.name == "code_challenge_method" }?.value == "S256")
            return try response(request, ["request_uri": "urn:example:par", "expires_in": 90])
        }
        if url.path == "/oauth/token" {
            tokenCalls += 1
            if invalidGrant { return try response(request, ["error":"invalid_grant","error_description":"The refresh token was revoked"], status:400, nonce:"nonce") }
            if String(data: request.httpBody!, encoding: .utf8)!.contains("refresh_token") { refreshCalls += 1 }
            if failRefresh { throw URLError(.notConnectedToInternet) }
            try await Task.sleep(for: .milliseconds(40))
            return try response(request, ["sub": returnedDID, "access_token": "rotated-access", "refresh_token": "rotated-refresh", "token_type": "DPoP", "expires_in": 3600, "scope": NativeConfiguration.scopes])
        }
        throw NativeError.invalidResponse
    }
}
@Test func oauthCompletesAndRejectsReplay() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(), http = OAuthFixtureHTTP()
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    let url = try await oauth.authorizationURL(for: "READER.EXAMPLE.COM")
    #expect(url.path == "/oauth/authorize")
    let callback = URL(string: "link.latr.testing:/oauth/ios?state=\(await http.state)&iss=https%3A%2F%2Fpds.example.com&code=test")!
    await #expect(throws: NativeError.invalidCallback) {
        try await oauth.completeAuthorization(callback: URL(string: "link.latr.testing:/oauth/ios?state=wrong&iss=https%3A%2F%2Fpds.example.com&code=test")!)
    }
    #expect(await vault.pendingAuthorization() != nil)
    let session = try await oauth.completeAuthorization(callback: callback)
    #expect(session.did == "did:plc:nativepreview")
    #expect(session.handle == "reader.example.com")
    #expect(try await oauth.restoreSession()?.privateKey == session.privateKey)
    await #expect(throws: NativeError.invalidCallback) { try await oauth.completeAuthorization(callback: callback) }
    #expect(await http.tokenCalls == 1)
}
@Test func oauthRejectsTokenSubjectMismatch() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(), http = OAuthFixtureHTTP(returnedDID: "did:plc:wrong")
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    _ = try await oauth.authorizationURL(for: "reader.example.com")
    let callback = URL(string: "link.latr.testing:/oauth/ios?state=\(await http.state)&iss=https%3A%2F%2Fpds.example.com&code=test")!
    await #expect(throws: NativeError.invalidIdentity) { try await oauth.completeAuthorization(callback: callback) }
    #expect(await vault.load() == nil)
}
@Test(arguments: [false, true]) func refreshSerializesAcrossIndependentClients(networkFailure: Bool) async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let original = NativeRuntime.previewSession(expired: true)
    let vault = MemorySessionVault(session: original), http = OAuthFixtureHTTP(failRefresh: networkFailure)
    let first = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    let second = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    if networkFailure {
        await #expect(throws: (any Error).self) { try await first.authenticated { session, _ in session.accessToken } }
        #expect(await vault.load() == original)
    } else {
        async let a = first.authenticated { session, _ in session.accessToken }
        async let b = second.authenticated { session, _ in session.accessToken }
        let tokens = try await [a,b]
        #expect(tokens == ["rotated-access", "rotated-access"])
        #expect(await http.refreshCalls == 1)
        #expect(await vault.load()?.refreshToken == "rotated-refresh")
    }
}

private actor GatewayFixtureHTTP: NativeHTTPClient {
    var requests: [URLRequest] = []
    var failSave: Bool
    let page: Data
    var tagMutationCalls = 0
    var tagVerificationPasses = 0
    var challengeGateway: Bool
    init(failSave: Bool = false, challengeGateway: Bool = false) throws { self.failSave = failSave; self.challengeGateway = challengeGateway; page = try JSONEncoder().encode(JSONDecoder().decode(BehaviorFixture.self, from: fixture("behavior")).bookmarkPage.bookmarks[0]) }
    func setFailSave(_ value: Bool) { failSave = value }
    func send(_ request: URLRequest) throws -> HTTPResult {
        requests.append(request)
        if request.url!.host == "pds.example.com" { return try response(request, request.httpMethod == "POST" ? ["error": "InvalidRequest"] : ["records": []], status: request.httpMethod == "POST" ? 400 : 200, nonce: "nonce-\(requests.count)") }
        if challengeGateway { challengeGateway = false; return try response(request, ["error":"use_dpop_nonce"], status:401, nonce:"gateway-next") }
        if request.url!.lastPathComponent == "link.latr.bookmarks.saveBookmark" {
            if failSave { throw URLError(.notConnectedToInternet) }
            return HTTPResult(data: page, response: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        if request.url!.lastPathComponent == "link.latr.bookmarks.listBookmarks" {
            let cursor = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "cursor" }?.value
            return try response(request, cursor == nil ? ["bookmarks": [JSONSerialization.jsonObject(with: page)], "cursor": "next"] : ["bookmarks": []])
        }
        if request.url!.lastPathComponent == "link.latr.bookmarks.listTags" {
            if tagMutationCalls > 0 {
                tagVerificationPasses += 1
                return try response(request, ["tagCounts": tagVerificationPasses < 2 ? [["tag":"old","count":1]] : [], "scanned":1])
            }
            let cursor = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "cursor" }?.value
            return try response(request, cursor == nil ? ["tagCounts": [["tag":"News","count":2],["tag":"e\u{301}","count":1]],"scanned":1,"cursor":"next"] : ["tagCounts":[["tag":"News","count":3],["tag":"é","count":4]],"scanned":1])
        }
        if request.url!.lastPathComponent == "link.latr.bookmarks.renameTag" {
            tagMutationCalls += 1
            if tagMutationCalls == 1 { return try response(request, ["error":"Conflict","message":"Concurrent edit"], status:409) }
            return try response(request, ["ok":true,"scanned":1,"matched":1,"updated":1])
        }
        if request.url!.lastPathComponent == "link.latr.bookmarks.migrateLegacy" {
            return try response(request, ["ok":true,"scanned":0,"created":0,"reused":0,"duplicates":0,"skippedConflict":0,"cached":0,"retired":0])
        }
        return try response(request, ["ok": true, "scanned": 0, "created": 0, "reused": 0, "skippedConflict": 0])
    }
}
private func testLibrary(directory: URL, vault: MemorySessionVault, http: GatewayFixtureHTTP) throws -> NativeLibrary {
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    return try NativeLibrary(configuration: configuration, oauth: oauth, store: NativeStore(directory: directory), http: http, directory: directory)
}
@Test func gatewayProofsAndCompatibilityMethod() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault(session: NativeRuntime.previewSession())
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    let transport = NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http)
    _ = try await transport.send(method: .setBookmarkState, parameters: [], body: Data("{}".utf8))
    let requests = await http.requests
    let sent = try #require(requests.last)
    #expect(sent.httpMethod == "PATCH")
    #expect(sent.value(forHTTPHeaderField: "X-Latr-Official-Client") == nil)
    let gatewayProof = try #require(sent.value(forHTTPHeaderField: "X-Latr-User-DPoP"))
    #expect(try jwtObject(gatewayProof, index: 1)["htu"] as? String == sent.url!.absoluteString)
    #expect(try jwtObject(gatewayProof, index: 1)["htm"] as? String == "PATCH")
    let proofs = try #require(sent.value(forHTTPHeaderField: "X-ATProto-Upstream-DPoP")).split(separator: ",").map(String.init)
    #expect(proofs.count == 3)
    #expect(try proofs.map { try jwtObject($0, index: 1)["htm"] as? String } == ["GET", "GET", "POST"])
    #expect(requests.first?.httpMethod == nil || requests.first?.httpMethod == "GET")
    #expect(try Set(proofs.map { try jwtObject($0, index: 1)["nonce"] as? String }).count == 3)
}
@Test func paginationTagCountsAndExport() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault(session: NativeRuntime.previewSession())
    let library = try testLibrary(directory: directory, vault: vault, http: http)
    let rows = try await library.listBookmarks(); #expect(rows.count == 1)
    #expect(try await library.cachedBookmarks().count == 1)
    let tags = try await library.listTags()
    #expect(tags.count == 3)
    #expect(tags.first { $0.tag == "News" }?.count == 5)
    let exportData = try await library.exportBookmarks()
    let exported = try JSONSerialization.jsonObject(with: exportData) as? [String: Any]
    #expect(exported?["did"] as? String == "did:plc:nativepreview")
    #expect((exported?["savedItems"] as? [[String: Any]])?.count == 1)
    #expect(exported?["bookmarks"] == nil)
}
@Test func queueSurvivesRecreationAndDoesNotCrossAccounts() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(failSave: true), vault = MemorySessionVault(session: NativeRuntime.previewSession())
    let library = try testLibrary(directory: directory, vault: vault, http: http)
    let pending = try await library.enqueueSave(subject: "https://example.com", tags: ["e\u{301}", "é"], expectedDID: "did:plc:nativepreview")
    await #expect(throws: (any Error).self) { try await library.drainPendingSaves() }
    let restored = try testLibrary(directory: directory, vault: vault, http: http)
    #expect(try await restored.pendingSaves().first?.id == pending.id)
    #expect(try await restored.pendingSaves().first?.lastError != nil)
    await vault.save(NativeRuntime.previewSession(did: "did:plc:other"))
    await http.setFailSave(false)
    try await restored.drainPendingSaves()
    #expect(try await restored.pendingSaves().count == 1)
    await vault.save(NativeRuntime.previewSession())
    try await restored.drainPendingSaves()
    #expect(try await restored.pendingSaves().isEmpty)
    let saveRequest = try #require(await http.requests.last { $0.url!.lastPathComponent == "link.latr.bookmarks.saveBookmark" })
    let sentTags = try #require((JSONSerialization.jsonObject(with: saveRequest.httpBody!) as? [String: Any])?["tags"] as? [String])
    #expect(sentTags.map { Data($0.utf8) } == [Data("e\u{301}".utf8),Data("é".utf8)])
}
@Test func unsignedDraftRequiresExplicitAdoption() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault()
    let library = try testLibrary(directory: directory, vault: vault, http: http)
    let draft = try await library.enqueueSave(subject: "https://example.com", expectedDID: nil)
    #expect(draft.did == nil)
    await vault.save(NativeRuntime.previewSession())
    try await library.drainPendingSaves()
    #expect(try await library.pendingSaves().count == 1)
    _ = try await library.adoptDraft(id: draft.id, expectedDID: "did:plc:nativepreview")
    try await library.drainPendingSaves()
    #expect(try await library.pendingSaves().isEmpty)
}
@Test func storeIsDurableAndEnvironmentSeparated() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try NativeStore(directory: directory)
    try await store.savePending(PendingSave(subject: "https://example.com", tags: [], did: nil, environment: .production))
    try await store.set("reader", for: "preference")
    let second = try NativeStore(directory: directory)
    #expect(try await second.value(String.self, for: "preference") == "reader")
    #expect(try await second.pendingSaves(environment: .testing).isEmpty)
    #expect(try await second.pendingSaves(environment: .production).count == 1)
}
@Test func operationIdentityIsCheckedInsideLock() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault(session: NativeRuntime.previewSession(did: "did:plc:other"))
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    let transport = NativeGatewayTransport(oauth: oauth, configuration: configuration, http: http, expectedDID: "did:plc:nativepreview")
    await #expect(throws: NativeError.invalidIdentity) { try await transport.send(method: .listTags, parameters: [], body: nil) }
    #expect(await http.requests.isEmpty)
}
@Test func migrationUsesBodyProofsAndCompletionCheckpoint() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault(session: NativeRuntime.previewSession())
    let library = try testLibrary(directory: directory, vault: vault, http: http)
    try await library.migrateLegacyIfNeeded()
    let request = try #require(await http.requests.last { $0.url!.lastPathComponent == "link.latr.bookmarks.migrateLegacy" })
    #expect(request.value(forHTTPHeaderField: "X-ATProto-Upstream-DPoP") == nil)
    let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
    let pool = try #require(body["upstreamDpopProof"] as? String)
    #expect(pool.split(separator: ",").count == 90)
    let before = await http.requests.count
    try await library.migrateLegacyIfNeeded()
    #expect(await http.requests.count == before)
}
@Test func globalTagJobRetriesConflictAndVerifiesConvergence() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let http = try GatewayFixtureHTTP(), vault = MemorySessionVault(session: NativeRuntime.previewSession())
    let library = try testLibrary(directory: directory, vault: vault, http: http)
    try await library.renameTag("old", replacement: "new")
    #expect(await http.tagMutationCalls == 3)
    #expect(await http.tagVerificationPasses == 2)
}
@Test func queueEditCannotOverwriteInFlightPayload() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let store = try NativeStore(directory: directory)
    let row = PendingSave(subject: "https://example.com", tags: [], did: "did:plc:one", environment: .testing)
    try await store.savePending(row)
    let first = ProcessLock(file: directory.appending(path: "queue.lock"))
    let second = ProcessLock(file: directory.appending(path: "queue.lock"))
    _ = try await first.withLock {
        await #expect(throws: NativeError.busy) {
            try await second.withLock(timeout: .milliseconds(60)) { try await store.updatePending(id: row.id, subject: row.subject, tags: ["edited"]) }
        }
    }
    #expect(try await store.pendingSaves(environment:.testing).first?.tags == [])
    try await second.withLock { try await store.updatePending(id: row.id, subject: row.subject, tags: ["edited"]) }
    #expect(try await store.pendingSaves(environment:.testing).first?.tags == ["edited"])
}
@Test func readingDestinationsMatchSupportedWebMappings() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let runtime = try NativeRuntime.preview(directory: directory)
    func bookmark(_ subject: String) -> BookmarkView {
        BookmarkView(record: RepositoryRecord(uri: "at://did:plc:example/community.lexicon.bookmarks.bookmark/id", cid: "test", value: CommunityBookmark(subject: subject, createdAt: "2026-09-14T00:00:00Z")))
    }
    #expect(try await runtime.library.readingURL(for: bookmark("HTTPS://example.com/Article"))?.host == "example.com")
    #expect(try await runtime.library.readingURL(for: bookmark("at://did:plc:example/app.bsky.feed.post/abc"))?.absoluteString == "https://bsky.app/profile/did:plc:example/post/abc")
    #expect(try await runtime.library.readingURL(for: bookmark("at://did:plc:example/site.standard.document/abc")) == nil)
}
@Test func oauthRejectsChangedAuthorizingServerAfterBrowserReturn() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(), http = OAuthFixtureHTTP(changedIssuer:true)
    let oauth = OAuthClient(configuration: configuration, vault: vault, http: http, directory: directory)
    _ = try await oauth.authorizationURL(for: "reader.example.com")
    let callback = URL(string: "link.latr.testing:/oauth/ios?state=\(await http.state)&iss=https%3A%2F%2Fpds.example.com&code=test")!
    await #expect(throws: NativeError.invalidIdentity) { try await oauth.completeAuthorization(callback: callback) }
    #expect(await vault.load() == nil)
}
@Test func invalidGrantIsNotRetriedEvenWithDescriptionAndNonce() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(session:NativeRuntime.previewSession(expired:true)), http = OAuthFixtureHTTP(invalidGrant:true)
    let oauth = OAuthClient(configuration:configuration,vault:vault,http:http,directory:directory)
    await #expect(throws: NativeError.sessionExpired) { try await oauth.authenticated { session,_ in session.accessToken } }
    #expect(await http.tokenCalls == 1)
}
@Test func gatewayNonceChallengeRegeneratesEveryProof() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(session:NativeRuntime.previewSession()), http = try GatewayFixtureHTTP(challengeGateway:true)
    let oauth = OAuthClient(configuration:configuration,vault:vault,http:http,directory:directory)
    _ = try await NativeGatewayTransport(oauth:oauth,configuration:configuration,http:http).send(method:.setBookmarkState,parameters:[],body:Data("{}".utf8))
    let sent = await http.requests.filter { $0.url!.host == "testing.latr.link" }
    #expect(sent.count == 2)
    let pools = sent.compactMap { $0.value(forHTTPHeaderField:"X-ATProto-Upstream-DPoP") }
    #expect(pools.count == 2)
    #expect(pools[0] != pools[1])
    let proof = try #require(sent.last?.value(forHTTPHeaderField:"X-Latr-User-DPoP"))
    #expect(try jwtObject(proof,index:1)["nonce"] as? String == "gateway-next")
}
@Test func reviewedAccountCannotBeSilentlyRebound() async throws {
    let directory = try temporaryDirectory(); defer { try? FileManager.default.removeItem(at: directory) }
    let vault = MemorySessionVault(session:NativeRuntime.previewSession(did:"did:plc:other")), http = try GatewayFixtureHTTP()
    let library = try testLibrary(directory:directory,vault:vault,http:http)
    await #expect(throws: NativeError.invalidIdentity) { try await library.enqueueSave(subject:"https://example.com",expectedDID:"did:plc:nativepreview") }
    let draft = try await library.enqueueSave(subject:"https://example.com",expectedDID:nil)
    #expect(draft.did == nil)
    await #expect(throws: NativeError.invalidIdentity) { try await library.adoptDraft(id:draft.id,expectedDID:"did:plc:nativepreview") }
    #expect(try await library.pendingSaves().first?.did == nil)
}
@Test func contentClassificationAndReadingEstimate() throws {
    func row(_ subject:String,title:String?="An article",description:String?=nil,author:String?=nil)->BookmarkView {
        BookmarkView(record:RepositoryRecord(uri:"at://did:plc:test/community.lexicon.bookmarks.bookmark/id",cid:"test",value:CommunityBookmark(subject:subject,createdAt:"2026-09-14T00:00:00Z")),preview:OpenGraphPreview(title:title,description:description,author:author))
    }
    #expect(row("https://bsky.app/profile/test/post/abc").nativeContentKind == .social)
    #expect(row("at://did:plc:test/site.standard.document/abc").nativeContentKind == .article)
    #expect(row("https://example.com/two/segments").nativeContentKind == .article)
    #expect(row("https://example.com/",author:"Author").nativeContentKind == .article)
    #expect(row("https://example.com/long-title-with-hyphens",title:"Saved from example.com").nativeContentKind == .other)
    #expect(row("https://example.com/").nativeContentKind == .other)
    #expect(row("https://example.com/",title:"a").estimatedReadingMinutes == 2)
    #expect(row("https://example.com/",title:String(repeating:"😀",count:100)).estimatedReadingMinutes == 3)
    #expect(row("https://example.com/",description:String(repeating:"long ",count:1000)).estimatedReadingMinutes == 12)
}
