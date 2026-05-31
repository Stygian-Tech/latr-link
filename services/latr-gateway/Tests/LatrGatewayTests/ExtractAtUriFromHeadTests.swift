import LatrGatewayLib
import XCTest

final class ExtractAtUriFromHeadTests: XCTestCase {
    func testFindsStandardSiteLink() {
        let html = """
        <html><head>
        <link rel="site.standard.document" href="at://did:plc:abc/com.example.post/rkey1" />
        </head><body></body></html>
        """
        XCTAssertEqual(
            extractAtUriFromHead(html),
            "at://did:plc:abc/com.example.post/rkey1"
        )
    }

    func testFindsGenericLinkHref() {
        let html = """
        <html><head>
        <link rel="canonical" href="at://did:plc:abc/app.bsky.feed.post/3abc" />
        </head></html>
        """
        XCTAssertEqual(
            extractAtUriFromHead(html),
            "at://did:plc:abc/app.bsky.feed.post/3abc"
        )
    }

    func testFindsMetaContentAtUri() {
        let html = """
        <html><head>
        <meta property="og:url" content="at://did:plc:abc/com.example.article/rkey2" />
        </head></html>
        """
        XCTAssertEqual(
            extractAtUriFromHead(html),
            "at://did:plc:abc/com.example.article/rkey2"
        )
    }

    func testPrefersNativeUriOverExternalWrapper() {
        let html = """
        <html><head>
        <link href="at://did:plc:abc/com.latr.saved.external/wrap1" />
        <link href="at://did:plc:abc/com.example.post/native1" />
        </head></html>
        """
        XCTAssertEqual(
            extractAtUriFromHead(html),
            "at://did:plc:abc/com.example.post/native1"
        )
    }

    func testRejectsPartialAtUri() {
        let html = """
        <html><head>
        <meta content="at://did:plc:abc/app.bsky.feed.post" />
        </head></html>
        """
        XCTAssertNil(extractAtUriFromHead(html))
    }
}
