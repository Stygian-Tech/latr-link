import AsyncHTTPClient
import Foundation
import Hummingbird
import Logging
import PostgresNIO

public enum GatewayBootstrap {
    public static func run(config: GatewayConfig, httpClient: HTTPClient, logger: Logger) async throws {
        let developerStore: any DeveloperStore
        let storeLabel: String
        var pgPool: PostgresClient?

        if let databaseURL = config.databaseURL, config.appEnv != .test {
            let pgConfig = try makePostgresConfig(from: databaseURL, logger: logger)
            let pool = PostgresClient(configuration: pgConfig, backgroundLogger: logger)
            pgPool = pool
            developerStore = PostgresDeveloperStore(
                pool: pool,
                officialEnvCredentials: config.officialClientCredentials,
                logger: logger
            )
            storeLabel = "postgres"
        } else {
            developerStore = DeveloperStoreFactory.make(config: config, logger: logger)
            storeLabel = config.appEnv == .test ? "memory" : "json"
        }

        let services = GatewayServices(
            config: config,
            httpClient: httpClient,
            developerStore: developerStore
        )
        let router = buildRouter(services: services)
        let app = Application(
            router: router,
            configuration: .init(address: .hostname("0.0.0.0", port: config.port))
        )

        logger.info(
            "latr-gateway listening on port \(config.port) (APP_ENV=\(config.appEnv.rawValue), store=\(storeLabel))"
        )

        if let pgPool {
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { await pgPool.run() }
                group.addTask { try await app.runService() }
                try await group.next()
                group.cancelAll()
            }
        } else {
            try await app.runService()
        }
    }
}
