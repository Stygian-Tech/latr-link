import LatrGatewayLib
import XCTest

final class PersistentDeveloperStoreTests: XCTestCase {
    private func storeURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("latr-dev-store-\(UUID().uuidString).json")
    }

    func testCreateClientPersistsToDisk() async throws {
        let url = storeURL()
        let store = PersistentDeveloperStore(officialEnvCredentials: [:], storeURL: url)

        let created = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "my-app",
            displayName: "L@tr.link",
            isOfficial: false
        )
        XCTAssertEqual(created.clientID, "my-app")
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))

        let reloaded = PersistentDeveloperStore(officialEnvCredentials: [:], storeURL: url)
        let listed = try await reloaded.listClients(ownerDID: "did:plc:developer")
        XCTAssertEqual(listed.map(\.clientID), ["my-app"])
    }

    func testCreateApiKeyPersistsToDisk() async throws {
        let url = storeURL()
        let store = PersistentDeveloperStore(officialEnvCredentials: [:], storeURL: url)
        _ = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "my-app",
            displayName: nil,
            isOfficial: false
        )

        let created = try await store.createApiKey(
            ownerDID: "did:plc:developer",
            clientID: "my-app",
            label: "primary"
        )
        XCTAssertFalse(created.apiKey.isEmpty)

        let reloaded = PersistentDeveloperStore(officialEnvCredentials: [:], storeURL: url)
        let keys = try await reloaded.listApiKeys(ownerDID: "did:plc:developer", clientID: "my-app")
        XCTAssertEqual(keys.count, 1)
        XCTAssertEqual(keys.first?.label, "primary")
    }
}
