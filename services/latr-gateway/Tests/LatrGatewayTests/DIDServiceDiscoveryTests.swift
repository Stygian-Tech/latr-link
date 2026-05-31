import LatrGatewayLib
import XCTest

final class DIDServiceDiscoveryTests: XCTestCase {
    func testParsesAppViewServicesFromDIDDocument() {
        let doc: [String: Any] = [
            "service": [
                [
                    "id": "#atproto_pds",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://pds.example.com/",
                ],
                [
                    "id": "#bsky_appview",
                    "type": "BskyAppView",
                    "serviceEndpoint": "https://appview.example.com",
                ],
                [
                    "id": "#atproto_appview",
                    "type": "AtprotoAppView",
                    "serviceEndpoint": "https://relay.example.com/",
                ],
            ],
        ]

        XCTAssertEqual(
            parseAppViewEndpointsFromDIDDoc(doc),
            ["https://appview.example.com", "https://relay.example.com"]
        )
        XCTAssertEqual(parsePDSEndpointFromDIDDoc(doc), "https://pds.example.com")
    }

    func testParsesIdentityServiceFromDIDDocument() {
        let doc: [String: Any] = [
            "service": [
                [
                    "id": "#atproto_identity",
                    "type": "AtprotoPersonalDataServer",
                    "serviceEndpoint": "https://identity.example.com",
                ],
            ],
        ]

        XCTAssertEqual(parseIdentityEndpointFromDIDDoc(doc), "https://identity.example.com")
    }

    func testBuildsDidWebDocumentURL() {
        XCTAssertEqual(
            didDocumentURL(for: "did:web:example.com", plcURL: "https://plc.directory")?.absoluteString,
            "https://example.com/.well-known/did.json"
        )
        XCTAssertEqual(
            didDocumentURL(for: "did:web:example.com:user:alice", plcURL: "https://plc.directory")?.absoluteString,
            "https://example.com/user/alice/did.json"
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
}
