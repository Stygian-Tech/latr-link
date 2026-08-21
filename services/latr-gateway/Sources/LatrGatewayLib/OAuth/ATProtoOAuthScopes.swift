import Foundation

/// Exact repository mutations used by L@tr.link clients.
/// Keep `scope` aligned with `packages/latr-web-client/src/atprotoOAuthScopes.ts`
/// and `webScope` aligned with `apps/web/src/lib/atprotoOAuthScopes.ts`.
public enum ATProtoOAuthScopes {
    public static let bookmarkScopes = [
        "repo:community.lexicon.bookmarks.bookmark?action=create&action=update&action=delete",
    ]

    public static let readingStateScope = "include:link.latr.authFull"

    public static let migrationCleanupScopes = [
        "repo:link.latr.saved.external?action=delete",
        "repo:link.latr.saved.item?action=delete",
        "repo:com.latr.saved.external?action=delete",
        "repo:com.latr.saved.item?action=delete",
    ]

    private static let baseScopes = ["atproto"]
        + bookmarkScopes
        + [readingStateScope]
        + migrationCleanupScopes

    public static let scope = baseScopes.joined(separator: " ")

    public static let webScope = (baseScopes + [
        "include:app.userinput.authFull",
        "blob:*/*",
    ]).joined(separator: " ")
}
