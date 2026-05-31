import AsyncHTTPClient
import Foundation
import LatrGatewayLib
import Logging

@main
struct LatrGatewayApp {
    static func main() async throws {
        let config = GatewayConfig.load()
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let logger = Logger(label: "latr-gateway")

        do {
            try await GatewayBootstrap.run(config: config, httpClient: httpClient, logger: logger)
        } catch {
            try? await httpClient.shutdown()
            throw error
        }
        try await httpClient.shutdown()
    }
}
