import Foundation

public enum SavedLibraryError: Error, Sendable {
    case invalidURL
    case itemNotFound
}

public struct ExternalSaveReference: Sendable {
    public let normalizedURL: String
    public let recordKey: String
    public let wrapperURI: String
}

public struct SavedItemReference: Sendable {
    public let uri: String
    public let recordKey: String
}

/// Orchestrates L@tr save, list, and state workflows against a repository.
public struct SavedLibrary: Sendable {
    public let repository: any RepositoryClient
    public let repositoryDID: String

    public init(repository: any RepositoryClient, repositoryDID: String) {
        self.repository = repository
        self.repositoryDID = repositoryDID
    }

    public func savedItems() async throws -> [RepositoryRecord<SavedItem>] {
        var all: [RepositoryRecord<SavedItem>] = []
        var cursor: String?
        repeat {
            let page: RecordList<SavedItem> = try await repository.listRecords(
                in: repositoryDID,
                collection: .savedItem,
                limit: 100,
                startingAfter: cursor
            )
            all.append(contentsOf: page.records)
            cursor = page.cursor
        } while cursor != nil
        return all
    }

    public func externalSave(withKey key: String) async throws -> RepositoryRecord<ExternalSave>? {
        try await repository.record(in: repositoryDID, collection: .external, withKey: key)
    }

    public func savedItem(withKey key: String) async throws -> RepositoryRecord<SavedItem>? {
        try await repository.record(in: repositoryDID, collection: .savedItem, withKey: key)
    }

    public func ensureExternalSave(for url: String, preview: OpenGraphPreview? = nil) async throws -> ExternalSaveReference {
        guard let normalizedURL = URLNormalizer.normalizedString(from: url) else {
            throw SavedLibraryError.invalidURL
        }

        let recordKey = RecordKey.key(forNormalizedURL: normalizedURL)
        if let existing = try await externalSave(withKey: recordKey) {
            if let preview,
               OpenGraphMerger.externalSaveNeedsPreview(existing.value),
               let merged = OpenGraphMerger.merging(into: existing.value, preview: preview)
            {
                _ = try await repository.updateRecord(
                    in: repositoryDID,
                    collection: .external,
                    withKey: recordKey,
                    value: merged
                )
            }
            return ExternalSaveReference(
                normalizedURL: normalizedURL,
                recordKey: recordKey,
                wrapperURI: existing.uri
            )
        }

        var value = ExternalSave(
            url: url,
            normalizedUrl: normalizedURL,
            fingerprint: RecordKey.fingerprint(forNormalizedURL: normalizedURL),
            createdAt: Timestamp.iso8601Now()
        )
        if let preview, let merged = OpenGraphMerger.merging(into: value, preview: preview) {
            value = merged
        }

        _ = try await repository.createRecord(
            in: repositoryDID,
            collection: .external,
            withKey: recordKey,
            value: value
        )

        return ExternalSaveReference(
            normalizedURL: normalizedURL,
            recordKey: recordKey,
            wrapperURI: ATURI.externalSave(repositoryDID: repositoryDID, recordKey: recordKey)
        )
    }

    @discardableResult
    public func upsertSavedItem(
        subjectURI: String,
        state: SavedItemState? = nil,
        linkedWebURL: String? = nil,
        preview: OpenGraphPreview? = nil
    ) async throws -> SavedItemReference {
        let recordKey = RecordKey.key(forSubjectURI: subjectURI)
        var value = SavedItem(subjectUri: subjectURI, savedAt: Timestamp.iso8601Now())
        if let state { value.state = state }
        if let linkedWebURL { value.linkedWebUrl = linkedWebURL }
        if let preview, let merged = OpenGraphMerger.merging(into: value, preview: preview) {
            value = merged
        }

        if let existing = try await savedItem(withKey: recordKey) {
            var merged = existing.value
            merged.subjectUri = value.subjectUri
            if let state = value.state { merged.state = state }
            if let linkedWebUrl = value.linkedWebUrl { merged.linkedWebUrl = linkedWebUrl }
            if let preview, let previewMerged = OpenGraphMerger.merging(into: merged, preview: preview) {
                merged = previewMerged
            }

            let response = try await repository.updateRecord(
                in: repositoryDID,
                collection: .savedItem,
                withKey: recordKey,
                value: merged
            )
            return SavedItemReference(uri: response.uri, recordKey: recordKey)
        }

        let response = try await repository.createRecord(
            in: repositoryDID,
            collection: .savedItem,
            withKey: recordKey,
            value: value
        )
        return SavedItemReference(uri: response.uri, recordKey: recordKey)
    }

    public func save(
        url: String,
        preview: OpenGraphPreview? = nil
    ) async throws {
        let reference = try await ensureExternalSave(for: url, preview: preview)
        _ = try await upsertSavedItem(
            subjectURI: reference.wrapperURI,
            state: .unread
        )
    }

    public func save(
        subjectURI: String,
        linkedWebURL: String? = nil,
        preview: OpenGraphPreview? = nil
    ) async throws {
        let normalizedLink: String?
        if let raw = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            normalizedLink = URLNormalizer.normalizedString(from: raw) ?? raw
        } else {
            normalizedLink = nil
        }

        _ = try await upsertSavedItem(
            subjectURI: subjectURI,
            state: .unread,
            linkedWebURL: normalizedLink,
            preview: preview
        )
    }

    public func setState(ofSavedItemWithKey key: String, to state: SavedItemState) async throws {
        guard let current = try await savedItem(withKey: key) else {
            throw SavedLibraryError.itemNotFound
        }

        var next = current.value
        next.state = state
        _ = try await repository.updateRecord(
            in: repositoryDID,
            collection: .savedItem,
            withKey: key,
            value: next
        )
    }

    public func removeSavedItem(withKey key: String) async throws {
        try await repository.deleteRecord(
            in: repositoryDID,
            collection: .savedItem,
            withKey: key
        )
    }

    public func removeExternalSave(for url: String, includingWrapper: Bool = false) async throws {
        guard let normalizedURL = URLNormalizer.normalizedString(from: url.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw SavedLibraryError.invalidURL
        }

        let externalKey = RecordKey.key(forNormalizedURL: normalizedURL)
        let wrapperURI = ATURI.externalSave(repositoryDID: repositoryDID, recordKey: externalKey)
        let itemKey = RecordKey.key(forSubjectURI: wrapperURI)

        try? await repository.deleteRecord(
            in: repositoryDID,
            collection: .savedItem,
            withKey: itemKey
        )

        if includingWrapper {
            try? await repository.deleteRecord(
                in: repositoryDID,
                collection: .external,
                withKey: externalKey
            )
        }
    }

    private func enrichExternalSave(withKey key: String, preview: OpenGraphPreview) async throws {
        guard let existing = try await externalSave(withKey: key),
              OpenGraphMerger.externalSaveNeedsPreview(existing.value),
              let merged = OpenGraphMerger.merging(into: existing.value, preview: preview)
        else {
            return
        }

        _ = try await repository.updateRecord(
            in: repositoryDID,
            collection: .external,
            withKey: key,
            value: merged
        )
    }

    private func enrichSavedItem(withKey key: String, preview: OpenGraphPreview) async throws {
        guard let existing = try await savedItem(withKey: key),
              OpenGraphMerger.savedItemNeedsPreview(existing.value),
              let merged = OpenGraphMerger.merging(into: existing.value, preview: preview)
        else {
            return
        }

        _ = try await repository.updateRecord(
            in: repositoryDID,
            collection: .savedItem,
            withKey: key,
            value: merged
        )
    }
}
