import Foundation
import LatrKit

public struct LexiconMigrationResponse: Encodable, Sendable {
    public let ok: Bool
    public let externalCopied: Int
    public let itemsCopied: Int
    public let externalDeleted: Int
    public let itemsDeleted: Int

    public init(summary: LexiconMigrationSummary) {
        self.ok = true
        self.externalCopied = summary.externalCopied
        self.itemsCopied = summary.itemsCopied
        self.externalDeleted = summary.externalDeleted
        self.itemsDeleted = summary.itemsDeleted
    }
}
