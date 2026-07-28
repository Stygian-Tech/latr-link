import Foundation
import LatrGatewayLib
import XCTest

final class ExtensionOAuthClientMetadataTests: XCTestCase {
    func testBuildsExtensionMetadataWithHostedCallback() throws {
        let data = try ExtensionOAuthClientMetadata.buildJSON(
            publicOrigin: "https://api.testing.latr.link",
            redirectOrigin: "https://testing.latr.link"
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(
            object["client_id"] as? String,
            "https://api.testing.latr.link/oauth/extension-client-metadata.json"
        )
        XCTAssertEqual(object["application_type"] as? String, "web")
        XCTAssertEqual(
            object["redirect_uris"] as? [String],
            ["https://testing.latr.link/extension/callback"]
        )
        XCTAssertEqual(object["scope"] as? String, ATProtoOAuthScopes.scope)
        XCTAssertEqual(object["client_uri"] as? String, "https://api.testing.latr.link")
        XCTAssertNil(object["logo_uri"])
        XCTAssertEqual(object["software_id"] as? String, "latr-extension")
    }
}
