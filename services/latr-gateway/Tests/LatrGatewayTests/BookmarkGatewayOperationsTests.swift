@testable import LatrGatewayLib
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
}
