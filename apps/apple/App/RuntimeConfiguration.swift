import Foundation
import LatrNativeCore

enum RuntimeConfiguration {
    static func make() throws -> NativeRuntime {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let environment = info["LATR_ENVIRONMENT"] as? String,
              let appGroup = info["LATR_APP_GROUP"] as? String,
              let keychainGroup = info["LATR_KEYCHAIN_GROUP"] as? String else {
            throw ConfigurationError.missingSettings
        }
        return try NativeRuntime(configuration: NativeConfiguration(
            environment: environment == "production" ? .production : .testing,
            appGroupIdentifier: appGroup,
            keychainAccessGroup: keychainGroup
        ))
    }

    enum ConfigurationError: LocalizedError {
        case missingSettings
        var errorDescription: String? { "Application settings are missing. Rebuild using the XcodeGen project." }
    }
}
