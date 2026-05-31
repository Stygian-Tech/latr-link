@testable import LatrKit
import XCTest

final class OpenGraphMergerTests: XCTestCase {
    func testExternalSaveNeedsPreviewWhenAuthorMissing() {
        let record = ExternalSave(
            url: "https://example.com",
            normalizedUrl: "https://example.com",
            fingerprint: "abc",
            createdAt: "2026-01-01T00:00:00Z",
            title: "Headline",
            image: "https://example.com/og.png"
        )

        XCTAssertTrue(OpenGraphMerger.externalSaveNeedsPreview(record))
    }

    func testExternalSaveDoesNotNeedPreviewWhenCoreFieldsPresent() {
        let record = ExternalSave(
            url: "https://example.com",
            normalizedUrl: "https://example.com",
            fingerprint: "abc",
            createdAt: "2026-01-01T00:00:00Z",
            title: "Headline",
            excerpt: "Lead",
            site: "Example",
            image: "https://example.com/og.png",
            author: "Ada Lovelace"
        )

        XCTAssertFalse(OpenGraphMerger.externalSaveNeedsPreview(record))
    }

    func testMergePrefersPrimaryFields() {
        let primary = OpenGraphPreview(title: "Native Title")
        let fallback = OpenGraphPreview(title: "OG Title", description: "Lead")

        let merged = OpenGraphMerger.merge(primary: primary, fallback: fallback)
        XCTAssertEqual(merged.title, "Native Title")
        XCTAssertEqual(merged.description, "Lead")
    }

    func testMergingAddsMissingAuthor() {
        let existing = ExternalSave(
            url: "https://example.com",
            normalizedUrl: "https://example.com",
            fingerprint: "abc",
            createdAt: "2026-01-01T00:00:00Z",
            title: "Headline",
            image: "https://example.com/og.png"
        )
        let preview = OpenGraphPreview(author: "Ada Lovelace")

        let merged = OpenGraphMerger.merging(into: existing, preview: preview)
        XCTAssertEqual(merged?.author, "Ada Lovelace")
    }
}
