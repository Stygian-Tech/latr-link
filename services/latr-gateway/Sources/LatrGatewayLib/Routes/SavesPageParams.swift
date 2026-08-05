import Foundation

/// Pagination query parameters for `GET /v1/latr/saves`.
public struct SavesPageParams: Sendable, Equatable {
    public let limit: Int
    public let cursor: String?

    public init(limit: Int, cursor: String?) {
        self.limit = limit
        self.cursor = cursor
    }

    /// Returns nil when `limit` is absent, selecting the legacy drain-all mode.
    public static func parse(limit rawLimit: String?, cursor rawCursor: String?) throws -> SavesPageParams? {
        guard let rawLimit else { return nil }
        guard let limit = Int(rawLimit.trimmingCharacters(in: .whitespaces)), limit > 0 else {
            throw GatewayError(status: .badRequest, message: "invalid limit", code: "invalid_limit")
        }
        let trimmedCursor = rawCursor?.trimmingCharacters(in: .whitespacesAndNewlines)
        return SavesPageParams(
            limit: min(limit, 100),
            cursor: trimmedCursor.flatMap { $0.isEmpty ? nil : $0 }
        )
    }
}
