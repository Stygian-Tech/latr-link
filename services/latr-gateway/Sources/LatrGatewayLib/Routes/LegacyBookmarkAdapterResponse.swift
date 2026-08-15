import LatrKit

public struct LegacyBookmarkAdapterValue: Encodable, Sendable {
    public let type = "link.latr.saved.item"
    public let subjectUri: String
    public let savedAt: String
    public let state: SavedItemState?
    public let tags: [String]?
    public let note: String?
    public let lastOpenedAt: String?

    enum CodingKeys: String, CodingKey {
        case type = "$type", subjectUri, savedAt, state, tags, note, lastOpenedAt
    }
}

public struct LegacyBookmarkAdapterRecord: Encodable, Sendable {
    public let uri: String
    public let cid: String
    public let value: LegacyBookmarkAdapterValue

    public init(_ view: BookmarkView) {
        uri = view.uri
        cid = view.cid
        value = LegacyBookmarkAdapterValue(
            subjectUri: view.value.subject,
            savedAt: view.value.createdAt,
            state: view.metadataRecord?.value.state,
            tags: view.value.tags,
            note: view.metadataRecord?.value.note,
            lastOpenedAt: view.metadataRecord?.value.lastOpenedAt
        )
    }
}

public struct LegacyBookmarkAdapterList: Encodable, Sendable {
    public let records: [LegacyBookmarkAdapterRecord]
    public let cursor: String?
}

public struct LegacyBookmarkAdapterLookup: Encodable, Sendable {
    public let record: LegacyBookmarkAdapterRecord?
}
