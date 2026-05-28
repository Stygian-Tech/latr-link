import HTTPTypes
import LatrGatewayLib
import XCTest

final class ClientRegistryTests: XCTestCase {
    private func registryURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("latr-client-registry-\(UUID().uuidString).json")
    }

    private func makeHeaders(_ values: [String: String]) -> HTTPFields {
        var headers = HTTPFields()
        for (name, value) in values {
            guard let fieldName = HTTPField.Name(name) else { continue }
            headers[fieldName] = value
        }
        return headers
    }

    func testRegisterClientPersistsAndVerifiesCredential() async throws {
        let url = registryURL()
        let registry = ClientRegistry(officialClients: [:], registryURL: url)

        let registered = try await registry.registerClient(
            clientID: "Social-Wire",
            displayName: "The Social Wire"
        )
        XCTAssertEqual(registered.clientId, "social-wire")
        XCTAssertFalse(registered.clientCredential.isEmpty)
        XCTAssertNotNil(Data(base64Encoded: registered.clientCredential))

        let resolved = try await registry.resolveClientID(
            from: makeHeaders([
                latrOfficialClientHeader: registered.clientCredential,
            ]),
            requireClientAPIKey: true
        )
        XCTAssertEqual(resolved, "social-wire")

        let reloaded = ClientRegistry(officialClients: [:], registryURL: url)
        let resolvedAgain = try await reloaded.resolveClientID(
            from: makeHeaders([
                latrOfficialClientHeader: registered.clientCredential,
            ]),
            requireClientAPIKey: true
        )
        XCTAssertEqual(resolvedAgain, "social-wire")
    }

    func testOfficialEnvCredentialsVerify() async throws {
        let credential = "dGVzdC1vZmZpY2lhbC1jcmVkZW50aWFs"
        let registry = ClientRegistry(
            officialClients: ["latr-web": credential],
            registryURL: registryURL()
        )

        let resolved = try await registry.resolveClientID(
            from: makeHeaders([
                latrOfficialClientHeader: credential,
            ]),
            requireClientAPIKey: true
        )
        XCTAssertEqual(resolved, "latr-web")
    }

    func testRegisterClientRejectsDuplicate() async throws {
        let registry = ClientRegistry(officialClients: [:], registryURL: registryURL())
        _ = try await registry.registerClient(clientID: "latr-web", displayName: nil)

        do {
            _ = try await registry.registerClient(clientID: "latr-web", displayName: nil)
            XCTFail("Expected duplicate registration to fail")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "client_exists")
        }
    }

    func testRevokeClientRemovesRegisteredCredential() async throws {
        let url = registryURL()
        let registry = ClientRegistry(officialClients: [:], registryURL: url)
        let registered = try await registry.registerClient(clientID: "revoke-me", displayName: nil)
        _ = try await registry.revokeClient(clientID: "revoke-me")

        do {
            _ = try await registry.resolveClientID(
                from: makeHeaders([
                    latrOfficialClientHeader: registered.clientCredential,
                ]),
                requireClientAPIKey: true
            )
            XCTFail("Expected revoked client to fail verification")
        } catch let error as GatewayError {
            XCTAssertTrue(
                error.code == "invalid_client_credential" || error.code == "client_credential_policy",
                "Unexpected error code: \(error.code)"
            )
        }
    }
}
