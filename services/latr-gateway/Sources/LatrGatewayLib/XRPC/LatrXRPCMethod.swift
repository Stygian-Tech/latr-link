import Foundation

/// Canonical NSIDs implemented by the directly-addressed L@tr XRPC service.
public enum LatrXRPCMethod: String, CaseIterable, Sendable {
    case listBookmarks = "link.latr.bookmarks.listBookmarks"
    case listTags = "link.latr.bookmarks.listTags"
    case getBookmark = "link.latr.bookmarks.getBookmark"
    case saveBookmark = "link.latr.bookmarks.saveBookmark"
    case syncBookmarkMetadata = "link.latr.bookmarks.syncMetadata"
    case setBookmarkState = "link.latr.bookmarks.setState"
    case setBookmarkTags = "link.latr.bookmarks.setTags"
    case renameBookmarkTag = "link.latr.bookmarks.renameTag"
    case deleteBookmarkTag = "link.latr.bookmarks.deleteTag"
    case deleteBookmark = "link.latr.bookmarks.deleteBookmark"
    case migrateBookmarks = "link.latr.bookmarks.migrateLegacy"
    case listItems = "link.latr.saved.listItems"
    case getItem = "link.latr.saved.getItem"
    case saveURL = "link.latr.saved.saveUrl"
    case saveSubject = "link.latr.saved.saveSubject"
    case setState = "link.latr.saved.setState"
    case deleteItem = "link.latr.saved.deleteItem"
    case migrateLegacy = "link.latr.saved.migrateLegacy"
    case getOpenGraph = "link.latr.preview.getOpenGraph"
    case resolveURL = "link.latr.discovery.resolveUrl"
    case authProbe = "link.latr.auth.probe"
    case listDeveloperClients = "link.latr.developer.listClients"
    case createDeveloperClient = "link.latr.developer.createClient"
    case deleteDeveloperClient = "link.latr.developer.deleteClient"
    case listDeveloperKeys = "link.latr.developer.listKeys"
    case createDeveloperKey = "link.latr.developer.createKey"
    case revokeDeveloperKey = "link.latr.developer.revokeKey"
    case getDeveloperUsage = "link.latr.developer.getUsage"

    public enum Kind: Equatable, Sendable {
        case query
        case procedure
    }

    public var kind: Kind {
        switch self {
        case .listBookmarks, .listTags, .getBookmark, .listItems, .getItem, .getOpenGraph, .resolveURL, .authProbe,
             .listDeveloperClients, .listDeveloperKeys, .getDeveloperUsage:
            .query
        case .saveBookmark, .syncBookmarkMetadata, .setBookmarkState, .setBookmarkTags,
             .renameBookmarkTag, .deleteBookmarkTag, .deleteBookmark, .migrateBookmarks,
             .saveURL, .saveSubject, .setState, .deleteItem, .migrateLegacy,
             .createDeveloperClient, .deleteDeveloperClient, .createDeveloperKey,
             .revokeDeveloperKey:
            .procedure
        }
    }

    public var requiresApplicationCredential: Bool {
        switch self {
        case .listDeveloperClients, .createDeveloperClient, .deleteDeveloperClient,
             .listDeveloperKeys, .createDeveloperKey, .revokeDeveloperKey,
             .getDeveloperUsage:
            false
        default:
            true
        }
    }
}
