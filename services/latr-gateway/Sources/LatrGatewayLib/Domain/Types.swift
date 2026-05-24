import Foundation

public enum Collection {
    public static let savedExternal = "com.latr.saved.external"
    public static let savedItem = "com.latr.saved.item"
}

public enum SavedItemState: String, Codable, Sendable {
    case unread
    case archived
}

public struct SavedExternalRecord: Codable, Sendable, Equatable {
    public var type: String
    public var url: String
    public var normalizedUrl: String
    public var fingerprint: String
    public var createdAt: String
    public var title: String?
    public var excerpt: String?
    public var site: String?
    public var image: String?
    public var language: String?
    public var publishedAt: String?
    public var author: String?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case url
        case normalizedUrl
        case fingerprint
        case createdAt
        case title
        case excerpt
        case site
        case image
        case language
        case publishedAt
        case author
    }

    public init(
        url: String,
        normalizedUrl: String,
        fingerprint: String,
        createdAt: String,
        title: String? = nil,
        excerpt: String? = nil,
        site: String? = nil,
        image: String? = nil,
        language: String? = nil,
        publishedAt: String? = nil,
        author: String? = nil
    ) {
        self.type = Collection.savedExternal
        self.url = url
        self.normalizedUrl = normalizedUrl
        self.fingerprint = fingerprint
        self.createdAt = createdAt
        self.title = title
        self.excerpt = excerpt
        self.site = site
        self.image = image
        self.language = language
        self.publishedAt = publishedAt
        self.author = author
    }
}

public struct SavedItemRecord: Codable, Sendable, Equatable {
    public var type: String
    public var subjectUri: String
    public var savedAt: String
    public var state: SavedItemState?
    public var tags: [String]?
    public var note: String?
    public var lastOpenedAt: String?
    public var linkedWebUrl: String?
    public var previewTitle: String?
    public var previewExcerpt: String?
    public var previewSite: String?
    public var previewImage: String?
    public var previewAuthor: String?

    enum CodingKeys: String, CodingKey {
        case type = "$type"
        case subjectUri
        case savedAt
        case state
        case tags
        case note
        case lastOpenedAt
        case linkedWebUrl
        case previewTitle
        case previewExcerpt
        case previewSite
        case previewImage
        case previewAuthor
    }

    public init(
        subjectUri: String,
        savedAt: String,
        state: SavedItemState? = nil,
        tags: [String]? = nil,
        note: String? = nil,
        lastOpenedAt: String? = nil,
        linkedWebUrl: String? = nil,
        previewTitle: String? = nil,
        previewExcerpt: String? = nil,
        previewSite: String? = nil,
        previewImage: String? = nil,
        previewAuthor: String? = nil
    ) {
        self.type = Collection.savedItem
        self.subjectUri = subjectUri
        self.savedAt = savedAt
        self.state = state
        self.tags = tags
        self.note = note
        self.lastOpenedAt = lastOpenedAt
        self.linkedWebUrl = linkedWebUrl
        self.previewTitle = previewTitle
        self.previewExcerpt = previewExcerpt
        self.previewSite = previewSite
        self.previewImage = previewImage
        self.previewAuthor = previewAuthor
    }
}

public struct OpenGraphMetadata: Sendable, Equatable {
    public var title: String?
    public var description: String?
    public var image: String?
    public var siteName: String?
    public var author: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        image: String? = nil,
        siteName: String? = nil,
        author: String? = nil
    ) {
        self.title = title
        self.description = description
        self.image = image
        self.siteName = siteName
        self.author = author
    }
}

public enum OGFieldMax {
    public static let title = 2048
    public static let excerpt = 8192
    public static let site = 512
    public static let author = 512
}
