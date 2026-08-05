import Foundation
import LatrKit

public struct SavedItemsResponse: Encodable, Sendable {
    public let records: [RepositoryRecord<SavedItem>]
    /// Present only in paged mode while more pages remain; omitted from JSON when nil.
    public let cursor: String?

    public init(records: [RepositoryRecord<SavedItem>], cursor: String? = nil) {
        self.records = records
        self.cursor = cursor
    }
}
