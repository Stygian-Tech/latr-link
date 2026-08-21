@testable import LatrGatewayLib
import LatrKit
import XCTest

final class BookmarkGatewayOperationsTests: XCTestCase {
    func testSyncMetadataLimitDefaultsAndAcceptsBounds() throws {
        XCTAssertEqual(try BookmarkGatewayOperations.syncMetadataLimit(nil), 50)
        XCTAssertEqual(try BookmarkGatewayOperations.syncMetadataLimit(1), 1)
        XCTAssertEqual(try BookmarkGatewayOperations.syncMetadataLimit(100), 100)
    }

    func testSyncMetadataLimitRejectsOutOfRangeValues() {
        for value in [0, 101] {
            XCTAssertThrowsError(try BookmarkGatewayOperations.syncMetadataLimit(value)) { error in
                XCTAssertEqual((error as? GatewayError)?.code, "invalid_request")
            }
        }
    }

    func testTagMutationLimitDefaultsAndAcceptsBounds() throws {
        XCTAssertEqual(try BookmarkGatewayOperations.tagMutationLimit(nil), 25)
        XCTAssertEqual(try BookmarkGatewayOperations.tagMutationLimit(1), 1)
        XCTAssertEqual(try BookmarkGatewayOperations.tagMutationLimit(25), 25)
    }

    func testTagMutationLimitRejectsOutOfRangeValues() {
        for value in [0, 26, 100] {
            XCTAssertThrowsError(try BookmarkGatewayOperations.tagMutationLimit(value)) { error in
                let gatewayError = error as? GatewayError
                XCTAssertEqual(gatewayError?.code, "invalid_request")
                XCTAssertEqual(gatewayError?.message, "limit must be between 1 and 25")
            }
        }
    }

    func testTagInputsDeclareOnlyCanonicalLexiconKeys() {
        XCTAssertEqual(LatrSetBookmarkTagsInput.allowedKeys, ["bookmarkUri", "tags"])
        XCTAssertEqual(LatrRenameBookmarkTagInput.allowedKeys, ["tag", "replacement", "limit", "cursor"])
        XCTAssertEqual(LatrDeleteBookmarkTagInput.allowedKeys, ["tag", "limit", "cursor"])
    }
}
