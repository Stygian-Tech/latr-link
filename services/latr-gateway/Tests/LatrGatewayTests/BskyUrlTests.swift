import LatrGatewayLib
import XCTest

final class BskyUrlTests: XCTestCase {
    func testExtractsProfilePostParts() throws {
        let url = try XCTUnwrap(URL(string: "https://bsky.app/profile/alice.bsky.social/post/3abc"))
        XCTAssertEqual(
            extractBskyAppProfilePostParts(from: url),
            BskyProfilePostParts(actor: "alice.bsky.social", rkey: "3abc")
        )
    }

    func testRejectsNonBskyHost() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com/profile/a/post/b"))
        XCTAssertNil(extractBskyAppProfilePostParts(from: url))
    }
}
