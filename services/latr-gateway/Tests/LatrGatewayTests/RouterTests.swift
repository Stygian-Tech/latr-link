import AsyncHTTPClient
import Hummingbird
import HummingbirdTesting
import LatrGatewayLib
import XCTest

final class RouterTests: XCTestCase {
    private func makeApp() -> (Application<RouterResponder<BasicRequestContext>>, HTTPClient) {
        let config = GatewayConfig(
            port: 8080,
            appEnv: .test,
            plcURL: "https://plc.directory",
            oauthRequireKnownClient: false,
            oauthAllowedClientIDs: []
        )
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let services = GatewayServices(config: config, httpClient: httpClient)
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
}
