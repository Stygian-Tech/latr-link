import HTTPTypes
import LatrGatewayLib
import XCTest

final class DeveloperStoreTests: XCTestCase {
    private func makeHeaders(_ values: [String: String]) -> HTTPFields {
        var headers = HTTPFields()
        for (name, value) in values {
            guard let fieldName = HTTPField.Name(name) else { continue }
            headers[fieldName] = value
        }
        return headers
    }

    func testSplitHeadersVerifyDeveloperKey() async throws {
        let store = InMemoryDeveloperStore()
        let created = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "my-app",
            displayName: "My App",
            isOfficial: false
        )
        let key = try await store.createApiKey(
            ownerDID: "did:plc:developer",
            clientID: created.clientID,
            label: "primary"
        )

        let resolved = try await store.resolveClientID(
            from: makeHeaders([
                latrClientIDHeader: created.clientID,
                latrAPIKeyHeader: key.apiKey,
            ]),
            requireClientAPIKey: true
        )
        XCTAssertEqual(resolved, created.clientID)
    }

    func testOfficialEnvLegacyHeaderStillWorks() async throws {
        let credential = "dGVzdC1vZmZpY2lhbC1jcmVkZW50aWFs"
        let store = InMemoryDeveloperStore(officialEnvCredentials: ["latr-link-web": credential])

        let resolved = try await store.resolveClientID(
            from: makeHeaders([
                latrOfficialClientHeader: credential,
            ]),
            requireClientAPIKey: true
        )
        XCTAssertEqual(resolved, "latr-link-web")
    }

    func testOfficialProvisionerGate() throws {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            oauthAllowedClientIDs: [],
            officialClientDID: "did:plc:official"
        )

        XCTAssertNoThrow(try assertOfficialProvisioner(did: "did:plc:official", config: config))
        XCTAssertThrowsError(try assertOfficialProvisioner(did: "did:plc:other", config: config))
    }

    func testCreateClientAllowsUnderscoresInClientID() async throws {
        let store = InMemoryDeveloperStore()
        let created = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "my_app-name",
            displayName: nil,
            isOfficial: false
        )
        XCTAssertEqual(created.clientID, "my_app-name")
    }

    func testCreateClientPreservesUnicodeDisplayName() async throws {
        let store = InMemoryDeveloperStore()
        let created = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "my-app",
            displayName: "L@tr.link 🔖 日本語",
            isOfficial: false
        )
        XCTAssertEqual(created.displayName, "L@tr.link 🔖 日本語")
    }

    func testRevokeApiKeyBlocksVerification() async throws {
        let store = InMemoryDeveloperStore()
        _ = try await store.createClient(
            ownerDID: "did:plc:developer",
            clientID: "revoke-me",
            displayName: nil,
            isOfficial: false
        )
        let key = try await store.createApiKey(
            ownerDID: "did:plc:developer",
            clientID: "revoke-me",
            label: nil
        )
        try await store.revokeApiKey(
            ownerDID: "did:plc:developer",
            clientID: "revoke-me",
            keyID: key.record.keyID
        )

        do {
            _ = try await store.resolveClientID(
                from: makeHeaders([
                    latrClientIDHeader: "revoke-me",
                    latrAPIKeyHeader: key.apiKey,
                ]),
                requireClientAPIKey: true
            )
            XCTFail("Expected revoked key to fail verification")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "invalid_client_credential")
        }
    }
}
