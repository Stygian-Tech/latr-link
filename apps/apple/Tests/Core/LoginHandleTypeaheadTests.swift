import Foundation
import Testing
@testable import LatrNativeCore

@Test func loginTypeaheadNormalizesAndRejectsNonHandleQueries() {
    #expect(LoginHandleTypeahead.query(for: " @alice.bsky.social ") == "alice.bsky.social")
    #expect(LoginHandleTypeahead.query(for: "alice") == "alice")
    for input in ["", "@", "a", "@a", "did:plc:alice", "https://alice.example", "alice/name", "alice smith", "alice\tsmith", "alice\u{00a0}smith", "alice\u{FEFF}smith"] {
        #expect(LoginHandleTypeahead.query(for: input) == nil)
    }
    // Match the browser's UTF-16 query-length semantics.
    #expect(LoginHandleTypeahead.query(for: "😀") == "😀")
}

@Test func loginTypeaheadSkipsInvalidInputWithoutSendingRequests() async throws {
    let http = TypeaheadHTTP()
    let client = LoginHandleTypeahead(http: http)
    #expect(try await client.search("did:plc:alice").isEmpty)
    #expect(await http.requests.isEmpty)
}

@Test func loginTypeaheadUsesPublicWAOWContractAndPreservesActorFields() async throws {
    let http = TypeaheadHTTP()
    let results = try await LoginHandleTypeahead(http: http).search(" @alice ")
    let request = try #require(await http.requests.first)
    let url = try #require(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
    #expect(url.scheme == "https")
    #expect(url.host == "typeahead.waow.tech")
    #expect(url.path == "/xrpc/app.bsky.actor.searchActorsTypeahead")
    #expect(url.queryItems == [URLQueryItem(name: "q", value: "alice"), URLQueryItem(name: "limit", value: "6")])
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(results.count == 1)
    #expect(results.first?.did == "did:plc:alice")
    #expect(results.first?.handle == "alice.example")
    #expect(results.first?.displayName == "Alice")
    #expect(results.first?.avatar == "https://cdn.example/avatar.jpg")
}

@Test func loginTypeaheadEmptyResponseAndServerFailure() async throws {
    let empty = TypeaheadHTTP(body: "{}")
    #expect(try await LoginHandleTypeahead(http: empty).search("alice").isEmpty)
    let failing = TypeaheadHTTP(status: 503)
    await #expect(throws: NativeError.self) {
        try await LoginHandleTypeahead(http: failing).search("alice")
    }
}

@Test func loginTypeaheadDiscardsCancelledTransportCompletion() async throws {
    let http = TypeaheadHTTP(delay: true)
    let client = LoginHandleTypeahead(http: http)
    let task = Task { try await client.search("alice") }
    while await http.requests.isEmpty { await Task.yield() }
    task.cancel()
    await #expect(throws: CancellationError.self) { try await task.value }
}

private actor TypeaheadHTTP: NativeHTTPClient {
    var requests: [URLRequest] = []
    let body: String
    let status: Int
    let delay: Bool
    init(body: String = #"{"actors":[{"did":"did:plc:alice","handle":"alice.example","displayName":"Alice","avatar":"https://cdn.example/avatar.jpg"}]}"#, status: Int = 200, delay: Bool = false) {
        self.body = body; self.status = status; self.delay = delay
    }
    func send(_ request: URLRequest) async throws -> HTTPResult {
        requests.append(request)
        // Deliberately ignore cancellation to prove the client checks after transport completion.
        if delay { try? await Task.sleep(for: .milliseconds(100)) }
        return HTTPResult(data: Data(body.utf8), response: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}
