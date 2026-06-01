import Foundation

/// OAuth scopes for L@tr.link web clients. Keep aligned with `apps/web/public/client-metadata.json`.
public enum ATProtoOAuthScopes {
    public static let scope = [
        "atproto",
        "repo:link.latr.saved.external?action=create&action=update&action=delete",
        "repo:link.latr.saved.item?action=create&action=update&action=delete",
        "repo:com.latr.saved.external?action=create&action=update&action=delete",
        "repo:com.latr.saved.item?action=create&action=update&action=delete",
    ].joined(separator: " ")
}
