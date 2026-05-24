import AsyncHTTPClient
import Foundation
import Hummingbird
import LatrGatewayLib
import Logging

@main
struct LatrGatewayApp {
    static func main() async throws {
        let config = GatewayConfig.load()
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)

        let services = GatewayServices(config: config, httpClient: httpClient)
        let router = buildRouter(services: services)
        let app = Application(
            router: router,
            configuration: .init(address: .hostname("0.0.0.0", port: config.port))
        )

        let logger = Logger(label: "latr-gateway")
        logger.info("latr-gateway listening on port \(config.port) (APP_ENV=\(config.appEnv.rawValue))")
        try await app.runService()
        try await httpClient.shutdown()
    }
}
