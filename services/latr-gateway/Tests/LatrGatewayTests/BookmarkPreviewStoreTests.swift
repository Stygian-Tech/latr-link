import LatrGatewayLib
import XCTest

final class BookmarkPreviewStoreTests: XCTestCase {
    func testInMemoryPreviewCacheIsKeyedOnlyByExactSubject() async throws {
        let store = InMemoryBookmarkPreviewStore()
        let exact = "https://Example.com/article?ref=encountered"
        let preview = OpenGraphFields(title: "Exact", description: nil, image: nil, siteName: "Example", author: nil)

        await store.store(preview, for: exact)

        let stored = await store.preview(for: exact)
        let normalized = await store.preview(for: "https://example.com/article")
        XCTAssertEqual(stored?.title, "Exact")
        XCTAssertNil(normalized)
    }
}
