import LatrGatewayLib
import XCTest

final class OgFetchGuardsTests: XCTestCase {
    func testBlocksLocalhost() {
        XCTAssertEqual(blockingReasonOGFetch("localhost"), "blocked_host")
        XCTAssertEqual(blockingReasonOGFetch("127.0.0.1"), "blocked_ipv4")
    }
}
