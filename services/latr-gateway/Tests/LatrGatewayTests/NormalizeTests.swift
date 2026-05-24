import LatrGatewayLib
import XCTest

final class NormalizeTests: XCTestCase {
    func testLowercasesHostAndScheme() {
        XCTAssertEqual(normalizeURL("HTTPS://Example.COM/foo"), "https://example.com/foo")
    }

    func testStripsFragment() {
        XCTAssertEqual(normalizeURL("https://a.com/x#y"), "https://a.com/x")
    }

    func testDropsTrackingParams() {
        XCTAssertEqual(
            normalizeURL("https://a.com/p?utm_source=x&ok=1&utm_campaign=z&fbclid=1&gclid=g&ref=r"),
            "https://a.com/p?ok=1"
        )
    }

    func testRejectsNonHTTP() {
        XCTAssertNil(normalizeURL("ftp://a.com"))
    }
}
