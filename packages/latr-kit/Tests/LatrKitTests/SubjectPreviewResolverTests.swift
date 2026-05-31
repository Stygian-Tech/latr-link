@testable import LatrKit
import XCTest

final class SubjectPreviewResolverTests: XCTestCase {
    func testMergePrefersSubjectTitleOverOg() {
        let subject = OpenGraphPreview(title: "Post Text", author: "@alice.bsky.social")
        let og = OpenGraphPreview(title: "OG Title", description: "Lead", image: "https://example.com/og.png")

        let merged = OpenGraphMerger.merge(primary: subject, fallback: og)
        XCTAssertEqual(merged.title, "Post Text")
        XCTAssertEqual(merged.description, "Lead")
        XCTAssertEqual(merged.image, "https://example.com/og.png")
        XCTAssertEqual(merged.author, "@alice.bsky.social")
    }

    func testPreviewFromExternalSaveRecord() async {
        let repo = MockRepository(records: [
            "ext-key": ExternalSave(
                url: "https://example.com",
                normalizedUrl: "https://example.com",
                fingerprint: "abc",
                createdAt: "2026-01-01T00:00:00Z",
                title: "Article",
                excerpt: "Summary",
                site: "Example",
                image: "https://example.com/thumb.png",
                author: "Ada"
            ),
        ])
        let resolver = SubjectPreviewResolver(repository: repo)
        let preview = await resolver.preview(
            for: "at://did:plc:test/com.latr.saved.external/ext-key"
        )

        XCTAssertEqual(preview.title, "Article")
        XCTAssertEqual(preview.description, "Summary")
        XCTAssertEqual(preview.siteName, "Example")
        XCTAssertEqual(preview.image, "https://example.com/thumb.png")
        XCTAssertEqual(preview.author, "Ada")
    }

    func testPreviewFromAppViewPost() async {
        let appView = MockAppView(posts: [
            "at://did:plc:test/app.bsky.feed.post/rkey": AppViewPostPreview(
                text: "Hello Bluesky",
                authorHandle: "alice.bsky.social",
                embedThumbURL: "https://cdn.example/thumb.jpg"
            ),
        ])
        let resolver = SubjectPreviewResolver(
            repository: MockRepository(records: [:]),
            appView: appView
        )
        let preview = await resolver.preview(for: "at://did:plc:test/app.bsky.feed.post/rkey")

        XCTAssertEqual(preview.title, "Hello Bluesky")
        XCTAssertEqual(preview.author, "@alice.bsky.social")
        XCTAssertEqual(preview.siteName, "alice.bsky.social")
        XCTAssertEqual(preview.image, "https://cdn.example/thumb.jpg")
    }
}

private struct MockAppView: AppViewFeedClient {
    let posts: [String: AppViewPostPreview]

    func postPreview(for subjectURI: String) async -> AppViewPostPreview? {
        posts[subjectURI]
    }
}

private struct MockRepository: RepositoryClient {
    let records: [String: ExternalSave]

    func listRecords<Value>(
        in repository: String,
        collection: LexiconCollection,
        limit: Int?,
        startingAfter cursor: String?
    ) async throws -> RecordList<Value> where Value: Codable & Sendable {
        RecordList(records: [], cursor: nil)
    }

    func record<Value>(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String
    ) async throws -> RepositoryRecord<Value>? where Value: Codable & Sendable {
        guard collection == .external, let value = records[key] else { return nil }
        let encoded = try JSONEncoder().encode(value)
        let decoded = try JSONDecoder().decode(Value.self, from: encoded)
        return RepositoryRecord(
            uri: "at://\(repository)/\(collection.identifier)/\(key)",
            cid: "bafytest",
            value: decoded
        )
    }

    func createRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String,
        value: some Encodable & Sendable
    ) async throws -> CreateRecordResponse {
        CreateRecordResponse(uri: "at://\(repository)/\(collection.identifier)/\(key)")
    }

    func updateRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String,
        value: some Encodable & Sendable
    ) async throws -> UpdateRecordResponse {
        UpdateRecordResponse(uri: "at://\(repository)/\(collection.identifier)/\(key)")
    }

    func deleteRecord(
        in repository: String,
        collection: LexiconCollection,
        withKey key: String
    ) async throws {}
}
