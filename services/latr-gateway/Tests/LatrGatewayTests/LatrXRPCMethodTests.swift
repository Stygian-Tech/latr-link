@testable import LatrGatewayLib
import XCTest

final class LatrXRPCMethodTests: XCTestCase {
    func testEveryMethodUsesLatrNamespace() {
        XCTAssertEqual(LatrXRPCMethod.allCases.count, 28)
        XCTAssertTrue(LatrXRPCMethod.allCases.allSatisfy { $0.rawValue.hasPrefix("link.latr.") })
    }

    func testQueryAndProcedureKindsAreStable() {
        XCTAssertEqual(LatrXRPCMethod.listItems.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.listBookmarks.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.listTags.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.getOpenGraph.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.saveBookmark.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.syncBookmarkMetadata.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.setBookmarkTags.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.renameBookmarkTag.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.deleteBookmarkTag.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.saveURL.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.revokeDeveloperKey.kind, .procedure)
    }

    func testOnlyDeveloperMethodsSkipApplicationCredential() {
        XCTAssertTrue(LatrXRPCMethod.listItems.requiresApplicationCredential)
        XCTAssertTrue(LatrXRPCMethod.listTags.requiresApplicationCredential)
        XCTAssertTrue(LatrXRPCMethod.renameBookmarkTag.requiresApplicationCredential)
        XCTAssertFalse(LatrXRPCMethod.listDeveloperClients.requiresApplicationCredential)
        XCTAssertFalse(LatrXRPCMethod.createDeveloperKey.requiresApplicationCredential)
    }
}
