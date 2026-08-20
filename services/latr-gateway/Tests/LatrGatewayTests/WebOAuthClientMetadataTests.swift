import Foundation
import LatrGatewayLib
import XCTest

final class WebOAuthClientMetadataTests: XCTestCase {
    func testOAuthScopesMatchTheExactRepositoryMutations() {
        XCTAssertEqual(
            ATProtoOAuthScopes.scope,
            "atproto "
                + "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete "
                + "include:link.latr.authFull "
                + "repo:link.latr.saved.external?action=delete "
                + "repo:link.latr.saved.item?action=delete "
                + "repo:com.latr.saved.external?action=delete "
                + "repo:com.latr.saved.item?action=delete"
        )
        XCTAssertEqual(
            ATProtoOAuthScopes.bookmarkScopes,
            ["repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete"]
        )
        XCTAssertEqual(ATProtoOAuthScopes.readingStateScope, "include:link.latr.authFull")
        XCTAssertEqual(ATProtoOAuthScopes.migrationCleanupScopes.count, 4)
        XCTAssertFalse(ATProtoOAuthScopes.scope.contains("transition:generic"))
        XCTAssertFalse(ATProtoOAuthScopes.scope.contains("repo:*"))
        XCTAssertEqual(
            ATProtoOAuthScopes.webScope,
            ATProtoOAuthScopes.scope
                + " include:app.userinput.authFull"
                + " blob:*/*"
        )
    }

    func testBuildsGatewayMetadataWithSeparateRedirectOrigin() throws {
        let data = try WebOAuthClientMetadata.buildJSON(
            publicOrigin: "https://api.testing.latr.link",
            redirectOrigin: "https://testing.latr.link"
        )
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(
            obj?["client_id"] as? String,
            "https://api.testing.latr.link/oauth/client-metadata.json"
        )
        XCTAssertEqual(
            obj?["redirect_uris"] as? [String],
            ["https://testing.latr.link/callback"]
        )
        XCTAssertEqual(obj?["scope"] as? String, ATProtoOAuthScopes.webScope)
        XCTAssertEqual(
            obj?["client_uri"] as? String,
            "https://api.testing.latr.link"
        )
        XCTAssertNil(obj?["logo_uri"])
    }
}
