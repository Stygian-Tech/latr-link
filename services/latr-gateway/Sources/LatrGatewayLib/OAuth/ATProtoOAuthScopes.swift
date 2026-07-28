import Foundation

/// Exact repository mutations used by L@tr.link web and extension clients.
/// Keep aligned with `packages/latr-web-client/src/atprotoOAuthScopes.ts`.
public enum ATProtoOAuthScopes {
    public static let scope = [
        "atproto",
        "repo:link.latr.saved.external?action=create&action=update",
        "repo:link.latr.saved.item?action=create&action=update&action=delete",
        "repo:com.latr.saved.external?action=delete",
        "repo:com.latr.saved.item?action=delete",
    ].joined(separator: " ")
}
