import Foundation
import XCTest

@testable import LatrGatewayLib

final class SavesPageParamsTests: XCTestCase {
    func testAbsentLimitSelectsLegacyMode() throws {
        XCTAssertNil(try SavesPageParams.parse(limit: nil, cursor: nil))
        XCTAssertNil(try SavesPageParams.parse(limit: nil, cursor: "ignored"))
    }

    func testValidLimitParses() throws {
        let params = try SavesPageParams.parse(limit: "50", cursor: nil)
        XCTAssertEqual(params, SavesPageParams(limit: 50, cursor: nil))
    }

    func testLimitClampsToOneHundred() throws {
        let params = try SavesPageParams.parse(limit: "500", cursor: nil)
        XCTAssertEqual(params?.limit, 100)
    }

    func testInvalidLimitThrows() {
        for raw in ["abc", "0", "-1", "", "1.5"] {
            XCTAssertThrowsError(try SavesPageParams.parse(limit: raw, cursor: nil)) { error in
                XCTAssertEqual((error as? GatewayError)?.code, "invalid_limit")
                XCTAssertEqual((error as? GatewayError)?.status, .badRequest)
            }
        }
    }

    func testCursorPassesThrough() throws {
        let params = try SavesPageParams.parse(limit: "25", cursor: "3jzfcijpj2z2a")
        XCTAssertEqual(params?.cursor, "3jzfcijpj2z2a")
    }

    func testEmptyOrWhitespaceCursorBecomesNil() throws {
        XCTAssertNil(try SavesPageParams.parse(limit: "25", cursor: "")?.cursor)
        XCTAssertNil(try SavesPageParams.parse(limit: "25", cursor: "   ")?.cursor)
    }

    func testLegacyResponseOmitsCursorKey() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(SavedItemsResponse(records: []))
        XCTAssertEqual(String(data: data, encoding: .utf8), #"{"records":[]}"#)
    }

    func testPagedResponseIncludesCursor() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(SavedItemsResponse(records: [], cursor: "abc"))
        XCTAssertEqual(String(data: data, encoding: .utf8), #"{"cursor":"abc","records":[]}"#)
    }
}
