import LatrGatewayLib
import XCTest

final class FederatedSubjectClientTests: XCTestCase {
    func testDefaultAppViewBaseURLsIncludePublicBskyAppView() {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false
        )
        XCTAssertEqual(config.appViewBaseURLs, [FederatedSubjectClient.defaultAppViewBaseURL])
        XCTAssertEqual(config.identityBaseURL, FederatedSubjectClient.defaultIdentityBaseURL)
    }

    func testBuildsXrpcURLWithIndexedQuery() {
        let url = xrpcURL(
            base: "https://example.appview.test",
            method: "app.bsky.feed.getPosts",
            indexedQuery: [("uris[0]", "at://did:plc:abc/app.bsky.feed.post/rkey")]
        )
        XCTAssertEqual(
            url?.absoluteString,
            "https://example.appview.test/xrpc/app.bsky.feed.getPosts?uris%5B0%5D=at://did:plc:abc/app.bsky.feed.post/rkey"
        )
    }

    func testMergeServiceBasesDedupesAndPreservesOrder() {
        XCTAssertEqual(
            mergeServiceBases(
                [["https://a.test", "https://b.test"], ["https://b.test", "https://c.test/"]],
                fallback: ["https://d.test"]
            ),
            ["https://a.test", "https://b.test", "https://c.test", "https://d.test"]
        )
    }

    func testAppViewCandidateOrderPrefersDidDocumentBeforeEnvFallback() {
        let doc: [String: Any] = [
            "service": [
                [
                    "id": "#bsky_appview",
                    "type": "BskyAppView",
                    "serviceEndpoint": "https://did-discovered.appview.test",
                ],
            ],
        ]

        XCTAssertEqual(
            mergeServiceBases(
                [parseAppViewEndpointsFromDIDDoc(doc), ["https://env.appview.test"]],
                fallback: [FederatedSubjectClient.defaultAppViewBaseURL]
            ),
            [
                "https://did-discovered.appview.test",
                "https://env.appview.test",
                FederatedSubjectClient.defaultAppViewBaseURL,
            ]
        )
    }

    func testParsesAtUriParts() {
        XCTAssertEqual(
            parseAtUri("at://did:plc:abc/app.bsky.feed.post/rkey/with/slash"),
            AtUriParts(repo: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "rkey/with/slash")
        )
    }
}
