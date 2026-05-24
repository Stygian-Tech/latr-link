import LatrGatewayLib
import XCTest

final class RecordsTests: XCTestCase {
    private let did = "did:plc:testviewer"

    func testEnsureExternalForURLCreatesDeterministicWrapperOnce() async throws {
        let fake = FakeRepoClient()
        let first = try await ensureExternalForURL(
            client: fake,
            did: did,
            url: "https://Example.COM/article?utm_source=x"
        )
        let second = try await ensureExternalForURL(
            client: fake,
            did: did,
            url: "https://example.com/article"
        )

        XCTAssertEqual(first.normalized, "https://example.com/article")
        XCTAssertEqual(second.wrapperURI, first.wrapperURI)
        XCTAssertEqual(
            fake.snapshotKeys().filter { $0.hasPrefix("\(Collection.savedExternal):") }.count,
            1
        )
    }

    func testSaveExternalURLCreatesRecordsWithOG() async throws {
        let fake = FakeRepoClient()
        try await saveExternalURL(
            client: fake,
            did: did,
            url: "https://news.example/story",
            og: OpenGraphMetadata(
                title: "Story",
                description: "Lead",
                image: "https://news.example/og.png"
            )
        )

        let externalRkey = rkeyFromNormalizedURL("https://news.example/story")
        let external = try await getExternal(client: fake, did: did, rkey: externalRkey)
        let wrapperURI = atURIForExternal(did: did, externalRkey: externalRkey)
        let itemRkey = rkeyFromSubjectURI(wrapperURI)
        let item = try await getSavedItem(client: fake, did: did, rkey: itemRkey)

        XCTAssertEqual(external?.value.title, "Story")
        XCTAssertEqual(item?.value.state, .unread)
    }

    func testSetSavedItemStateUpdatesExistingItem() async throws {
        let fake = FakeRepoClient()
        let subjectURI = "at://did:plc:author/app.bsky.feed.post/state"
        _ = try await upsertSavedItem(client: fake, did: did, subjectURI: subjectURI, state: .unread)
        let rkey = rkeyFromSubjectURI(subjectURI)
        try await setSavedItemState(client: fake, did: did, itemRkey: rkey, state: .archived)

        let record = try await getSavedItem(client: fake, did: did, rkey: rkey)
        XCTAssertEqual(record?.value.state, .archived)
    }

    func testDeleteSavedItemRemovesOnlyEdge() async throws {
        let fake = FakeRepoClient()
        try await saveExternalURL(client: fake, did: did, url: "https://delete.example/x")
        let externalRkey = rkeyFromNormalizedURL("https://delete.example/x")
        let wrapperURI = atURIForExternal(did: did, externalRkey: externalRkey)
        let itemRkey = rkeyFromSubjectURI(wrapperURI)

        try await deleteSavedItem(client: fake, did: did, itemRkey: itemRkey)

        XCTAssertFalse(fake.hasRecord(collection: Collection.savedItem, rkey: itemRkey))
        XCTAssertTrue(fake.hasRecord(collection: Collection.savedExternal, rkey: externalRkey))
    }
}
