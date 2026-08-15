import Foundation

/// Exact repository mutations used by L@tr.link web and extension clients.
/// Keep aligned with `packages/latr-web-client/src/atprotoOAuthScopes.ts`.
public enum ATProtoOAuthScopes {
    public static let scope = [
        "atproto",
        "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete",
        "repo:link.latr.bookmarks.metadata?action=create&action=update&action=delete",
        "repo:link.latr.saved.external?action=delete",
        "repo:link.latr.saved.item?action=delete",
        "repo:com.latr.saved.external?action=delete",
        "repo:com.latr.saved.item?action=delete",
    ].joined(separator: " ")
}
