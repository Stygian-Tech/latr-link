import AsyncHTTPClient
import Foundation
import Hummingbird
import HummingbirdTesting
import LatrGatewayLib
import XCTest

final class RouterTests: XCTestCase {
    private func registryURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("latr-router-registry-\(UUID().uuidString).json")
    }

    private func makeApp(
        config: GatewayConfig? = nil
    ) -> (Application<RouterResponder<BasicRequestContext>>, HTTPClient) {
        let resolvedConfig = config ?? GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            clientRegistryURL: registryURL()
        )
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let services = GatewayServices.make(config: resolvedConfig, httpClient: httpClient)
        let router = buildRouter(services: services)
        let app = Application(router: router)
        return (app, httpClient)
    }

    func testHealthReturnsOK() async throws {
        let (app, httpClient) = makeApp()
        try await app.test(.router) { client in
            try await client.execute(uri: "/health", method: .get) { response in
                XCTAssertEqual(response.status, .ok)
                let body = String(buffer: response.body)
                XCTAssertTrue(body.contains("\"status\":\"ok\""))
                XCTAssertTrue(body.contains("latr-gateway"))
            }
        }
        try await httpClient.shutdown()
    }

    func testAuthGateRejectsMissingAuthorization() async throws {
        let (app, httpClient) = makeApp()
        try await app.test(.router) { client in
            try await client.execute(uri: "/v1/latr/saves", method: .get) { response in
                XCTAssertEqual(response.status, .unauthorized)
            }
        }
        try await httpClient.shutdown()
    }

    func testAuthGateRejectsMissingClientAPIKeyWhenRequired() async throws {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            requireClientAPIKey: true,
            officialClientCredentials: ["latr-link-web": "dGVzdC1zZWNyZXQ="],
            clientRegistryURL: registryURL()
        )
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let services = GatewayServices.make(config: config, httpClient: httpClient)
        let router = buildRouter(services: services)
        let app = Application(router: router)

        try await app.test(.router) { client in
            try await client.execute(uri: "/v1/latr/saves", method: .get) { response in
                XCTAssertEqual(response.status, .forbidden)
            }
        }
        try await httpClient.shutdown()
    }

    func testDeveloperClientsRequireOAuth() async throws {
        let (app, httpClient) = makeApp()
        try await app.test(.router) { client in
            try await client.execute(uri: "/v1/latr/developer/clients", method: .get) { response in
                XCTAssertEqual(response.status, .unauthorized)
            }
        }
        try await httpClient.shutdown()
    }

    func testOAuthWebClientMetadataUsesRedirectOrigin() async throws {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            clientRegistryURL: registryURL(),
            oauthPublicOrigin: "https://testing.latr.link"
        )
        let (app, httpClient) = makeApp(config: config)

        try await app.test(.router) { client in
            try await client.execute(uri: "/oauth/client-metadata.json", method: .get) { response in
                XCTAssertEqual(response.status, .ok, String(buffer: response.body))
                let data = Data(buffer: response.body)
                let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                XCTAssertEqual(
                    obj["redirect_uris"] as? [String],
                    ["https://testing.latr.link/callback"]
                )
                XCTAssertEqual(
                    obj["client_id"] as? String,
                    "http://localhost/oauth/client-metadata.json"
                )
            }
        }
        try await httpClient.shutdown()
    }
}
