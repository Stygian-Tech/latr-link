import Foundation

/// Minimal Bluesky AppView post shape for subject preview resolution.
public struct AppViewPostPreview: Sendable, Equatable {
    public var text: String?
    public var authorHandle: String?
    public var embedThumbURL: String?

    public init(text: String? = nil, authorHandle: String? = nil, embedThumbURL: String? = nil) {
        self.text = text
        self.authorHandle = authorHandle
        self.embedThumbURL = embedThumbURL
    }
}

/// Gateway-injected client for enriched feed post previews (optional AppView + PDS fallback).
public protocol AppViewFeedClient: Sendable {
    func postPreview(for subjectURI: String) async -> AppViewPostPreview?
}
