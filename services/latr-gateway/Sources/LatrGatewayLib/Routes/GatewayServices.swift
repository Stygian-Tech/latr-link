import AsyncHTTPClient
import Foundation
import LatrKit
import Logging

public struct GatewayServices: Sendable {
    public let config: GatewayConfig
    public let httpClient: HTTPClient
    public let developerStore: any DeveloperStore
    public let previewStore: any BookmarkPreviewStore

    public init(config: GatewayConfig, httpClient: HTTPClient, developerStore: any DeveloperStore, previewStore: any BookmarkPreviewStore = InMemoryBookmarkPreviewStore()) {
        self.config = config
        self.httpClient = httpClient
        self.developerStore = developerStore
        self.previewStore = previewStore
    }

    public static func make(
        config: GatewayConfig,
        httpClient: HTTPClient,
        logger: Logger = Logger(label: "latr-gateway")
    ) -> GatewayServices {
        GatewayServices(
            config: config,
            httpClient: httpClient,
            developerStore: DeveloperStoreFactory.make(config: config, logger: logger)
        )
    }

    public func repositoryClient(for auth: AuthContext) -> PDSRepositoryClient {
        PDSRepositoryClient(auth: auth, plcURL: config.plcURL, httpClient: httpClient)
    }

    public func savedLibrary(for auth: AuthContext) -> SavedLibrary {
        SavedLibrary(repository: repositoryClient(for: auth), repositoryDID: auth.did)
    }

    public func federatedSubjectClient() -> FederatedSubjectClient {
        FederatedSubjectClient(
            httpClient: httpClient,
            config: FederatedSubjectClientConfig(
                plcURL: config.plcURL,
                appViewBaseURLs: config.appViewBaseURLs,
                identityBaseURL: config.identityBaseURL
            )
        )
    }
}
