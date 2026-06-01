import HTTPTypes
import LatrGatewayLib
import Testing

@Suite("Gateway client policy")
struct GatewayClientPolicyTests {
    @Test("OAuth policy accepts registered client id and api key")
    func acceptsRegisteredClientCredentials() async throws {
        let store = InMemoryDeveloperStore()
        _ = try await store.createClient(
            ownerDID: "did:plc:owner",
            clientID: "third-party-app",
            displayName: "Third Party",
            isOfficial: false
        )
        let (_, apiKey) = try await store.createApiKey(
            ownerDID: "did:plc:owner",
            clientID: "third-party-app",
            label: "default"
        )

        var headers = HTTPFields()
        headers[HTTPField.Name(latrClientIDHeader)!] = "third-party-app"
        headers[HTTPField.Name(latrAPIKeyHeader)!] = apiKey

        let resolved = try await store.resolveClientID(
            from: headers,
            requireClientAPIKey: true
        )
        #expect(resolved == "third-party-app")

        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: true,
            requireClientAPIKey: false
        )
        try assertKnownClient(config: config, resolvedClientID: resolved)
    }

    @Test("OAuth policy rejects missing developer store credentials")
    func rejectsMissingCredentials() {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: true,
            requireClientAPIKey: false
        )

        #expect(throws: GatewayError.self) {
            try assertKnownClient(config: config, resolvedClientID: nil)
        }
    }

    @Test("OAuth policy is disabled when require known client is off")
    func skipsWhenPolicyDisabled() throws {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            requireClientAPIKey: false
        )
        try assertKnownClient(config: config, resolvedClientID: nil)
    }
}
