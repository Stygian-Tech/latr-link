import Foundation

/// Resolves on-protocol preview metadata for a canonical `at://` subject URI.
/// Optional hook for arbitrary public PDS records (`com.atproto.repo.getRecord`).
public protocol UntypedRecordClient: Sendable {
    func recordValue(in repository: String, collection: String, withKey key: String) async -> [String: Any]?
}

public struct SubjectPreviewResolver: Sendable {
    public let repository: any RepositoryClient
    public let appView: (any AppViewFeedClient)?
    public let untyped: (any UntypedRecordClient)?

    public init(
        repository: any RepositoryClient,
        appView: (any AppViewFeedClient)? = nil,
        untyped: (any UntypedRecordClient)? = nil
    ) {
        self.repository = repository
        self.appView = appView
        self.untyped = untyped
    }

    public func preview(for subjectURI: String) async -> OpenGraphPreview {
        guard let parts = parseAtURI(subjectURI) else {
            return OpenGraphPreview()
        }

        if parts.collection == "app.bsky.feed.post", let appView {
            if let post = await appView.postPreview(for: subjectURI) {
                return previewFromBskyPost(post)
            }
            return OpenGraphPreview()
        }

        if parts.collection == LexiconCollection.external.identifier {
            if let record: RepositoryRecord<ExternalSave> = try? await repository.record(
                in: parts.repo,
                collection: .external,
                withKey: parts.rkey
            ) {
                return previewFromExternalSave(record.value)
            }
            return OpenGraphPreview()
        }

        if let untyped, let json = await untyped.recordValue(
            in: parts.repo,
            collection: parts.collection,
            withKey: parts.rkey
        ) {
            return previewFromGenericRecord(json)
        }

        return OpenGraphPreview()
    }

    private struct AtURIParts {
        let repo: String
        let collection: String
        let rkey: String
    }

    private func parseAtURI(_ uri: String) -> AtURIParts? {
        let trimmed = uri.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("at://") else { return nil }

        let withoutScheme = String(trimmed.dropFirst("at://".count))
        let segments = withoutScheme.split(separator: "/", omittingEmptySubsequences: false)
        guard segments.count >= 3 else { return nil }

        let repo = String(segments[0])
        let collection = String(segments[1])
        let rkey = segments.dropFirst(2).joined(separator: "/")
        guard !repo.isEmpty, !collection.isEmpty, !rkey.isEmpty else { return nil }

        return AtURIParts(repo: repo, collection: collection, rkey: rkey)
    }

    private func previewFromBskyPost(_ post: AppViewPostPreview) -> OpenGraphPreview {
        let title = trimmedNonEmpty(post.text.map { String($0.prefix(160)) })
        let handle = trimmedNonEmpty(post.authorHandle)
        let author = handle.map { $0.hasPrefix("@") ? $0 : "@\($0)" }
        let siteName = handle.map { $0.hasPrefix("@") ? String($0.dropFirst()) : $0 }

        return OpenGraphPreview(
            title: title,
            image: trimmedNonEmpty(post.embedThumbURL),
            siteName: siteName,
            author: author
        )
    }

    private func previewFromExternalSave(_ record: ExternalSave) -> OpenGraphPreview {
        OpenGraphPreview(
            title: trimmedNonEmpty(record.title),
            description: trimmedNonEmpty(record.excerpt),
            image: trimmedNonEmpty(record.image),
            siteName: trimmedNonEmpty(record.site),
            author: trimmedNonEmpty(record.author)
        )
    }

    private func previewFromGenericRecord(_ json: [String: Any]) -> OpenGraphPreview {
        let title = trimmedNonEmpty(json["title"] as? String)
            ?? trimmedNonEmpty((json["text"] as? String).map { String($0.prefix(160)) })
            ?? trimmedNonEmpty(json["name"] as? String)

        return OpenGraphPreview(title: title)
    }

    private func trimmedNonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
