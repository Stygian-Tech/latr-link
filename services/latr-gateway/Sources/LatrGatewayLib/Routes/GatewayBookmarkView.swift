import LatrKit

public struct GatewayBookmarkView: Encodable, Sendable {
    public let uri: String
    public let cid: String
    public let value: CommunityBookmark
    public let metadataRecord: RepositoryRecord<BookmarkMetadata>?
    public let preview: OpenGraphFields?

    public init(_ view: BookmarkView, preview: OpenGraphFields? = nil) {
        uri = view.uri; cid = view.cid; value = view.value; metadataRecord = view.metadataRecord; self.preview = preview
    }
}

public struct GatewayBookmarkList: Encodable, Sendable {
    public let bookmarks: [GatewayBookmarkView]
    public let cursor: String?
}

public struct GatewayBookmarkLookup: Encodable, Sendable {
    public let bookmark: GatewayBookmarkView?
}
