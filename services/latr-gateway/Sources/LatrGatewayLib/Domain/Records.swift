import Foundation

public enum RecordsError: Error, Sendable {
    case invalidURL
    case savedItemNotFound
}

public func listSavedItems(client: any LatrRepoClient, did: String) async throws -> [RepoRecord<SavedItemRecord>] {
    var all: [RepoRecord<SavedItemRecord>] = []
    var cursor: String?
    repeat {
        let page = try await client.listRecords(
            repo: did,
            collection: Collection.savedItem,
            limit: 100,
            cursor: cursor
        ) as ListRecordsPage<SavedItemRecord>
        all.append(contentsOf: page.records)
        cursor = page.cursor
    } while cursor != nil
    return all
}

public func getExternal(
    client: any LatrRepoClient,
    did: String,
    rkey: String
) async throws -> RepoRecord<SavedExternalRecord>? {
    try await client.getRecord(repo: did, collection: Collection.savedExternal, rkey: rkey)
}

public func getSavedItem(
    client: any LatrRepoClient,
    did: String,
    rkey: String
) async throws -> RepoRecord<SavedItemRecord>? {
    try await client.getRecord(repo: did, collection: Collection.savedItem, rkey: rkey)
}

public struct EnsureExternalResult: Sendable {
    public let normalized: String
    public let externalRkey: String
    public let wrapperURI: String
}

public func ensureExternalForURL(
    client: any LatrRepoClient,
    did: String,
    url: String
) async throws -> EnsureExternalResult {
    guard let normalized = normalizeURL(url) else {
        throw RecordsError.invalidURL
    }

    let externalRkey = rkeyFromNormalizedURL(normalized)
    if let existing = try await getExternal(client: client, did: did, rkey: externalRkey) {
        return EnsureExternalResult(
            normalized: normalized,
            externalRkey: externalRkey,
            wrapperURI: existing.uri
        )
    }

    let fingerprint = fingerprintFromNormalizedURL(normalized)
    let record = SavedExternalRecord(
        url: url,
        normalizedUrl: normalized,
        fingerprint: fingerprint,
        createdAt: iso8601Now()
    )

    _ = try await client.createRecord(
        repo: did,
        collection: Collection.savedExternal,
        rkey: externalRkey,
        record: record
    )

    return EnsureExternalResult(
        normalized: normalized,
        externalRkey: externalRkey,
        wrapperURI: atURIForExternal(did: did, externalRkey: externalRkey)
    )
}

public struct UpsertSavedItemResult: Sendable {
    public let uri: String
    public let rkey: String
}

public func upsertSavedItem(
    client: any LatrRepoClient,
    did: String,
    subjectURI: String,
    state: SavedItemState? = nil,
    linkedWebURL: String? = nil
) async throws -> UpsertSavedItemResult {
    let rkey = rkeyFromSubjectURI(subjectURI)
    var record = SavedItemRecord(subjectUri: subjectURI, savedAt: iso8601Now())
    if let state { record.state = state }
    if let linkedWebURL { record.linkedWebUrl = linkedWebURL }

    if let existing = try await getSavedItem(client: client, did: did, rkey: rkey) {
        var merged = existing.value
        merged.subjectUri = record.subjectUri
        if let state = record.state { merged.state = state }
        if let linkedWebUrl = record.linkedWebUrl { merged.linkedWebUrl = linkedWebUrl }

        let result = try await client.putRecord(
            repo: did,
            collection: Collection.savedItem,
            rkey: rkey,
            record: merged
        )
        return UpsertSavedItemResult(uri: result.uri, rkey: rkey)
    }

    let result = try await client.createRecord(
        repo: did,
        collection: Collection.savedItem,
        rkey: rkey,
        record: record
    )
    return UpsertSavedItemResult(uri: result.uri, rkey: rkey)
}

public func enrichExternalFromOG(
    client: any LatrRepoClient,
    did: String,
    externalRkey: String,
    og: OpenGraphMetadata
) async throws {
    guard let existing = try await getExternal(client: client, did: did, rkey: externalRkey),
          externalNeedsOGEnrichment(existing.value),
          let merged = applyOGToExternal(existing: existing.value, og: og)
    else {
        return
    }

    _ = try await client.putRecord(
        repo: did,
        collection: Collection.savedExternal,
        rkey: externalRkey,
        record: merged
    )
}

public func enrichSavedItemFromOG(
    client: any LatrRepoClient,
    did: String,
    itemRkey: String,
    og: OpenGraphMetadata
) async throws {
    guard let existing = try await getSavedItem(client: client, did: did, rkey: itemRkey),
          savedItemNeedsOGEnrichment(existing.value),
          let merged = applyOGToSavedItem(existing: existing.value, og: og)
    else {
        return
    }

    _ = try await client.putRecord(
        repo: did,
        collection: Collection.savedItem,
        rkey: itemRkey,
        record: merged
    )
}

public func saveExternalURL(
    client: any LatrRepoClient,
    did: String,
    url: String,
    og: OpenGraphMetadata? = nil
) async throws {
    let ensured = try await ensureExternalForURL(client: client, did: did, url: url)
    _ = try await upsertSavedItem(
        client: client,
        did: did,
        subjectURI: ensured.wrapperURI,
        state: .unread
    )
    if let og {
        try await enrichExternalFromOG(
            client: client,
            did: did,
            externalRkey: ensured.externalRkey,
            og: og
        )
    }
}

public func saveSubjectURI(
    client: any LatrRepoClient,
    did: String,
    subjectURI: String,
    linkedWebURL: String? = nil,
    og: OpenGraphMetadata? = nil
) async throws {
    let normalizedLink: String?
    if let raw = linkedWebURL?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
        normalizedLink = normalizeURL(raw) ?? raw
    } else {
        normalizedLink = nil
    }

    _ = try await upsertSavedItem(
        client: client,
        did: did,
        subjectURI: subjectURI,
        state: .unread,
        linkedWebURL: normalizedLink
    )

    if let normalizedLink, let og {
        let itemRkey = rkeyFromSubjectURI(subjectURI)
        try await enrichSavedItemFromOG(client: client, did: did, itemRkey: itemRkey, og: og)
    }
}

public func setSavedItemState(
    client: any LatrRepoClient,
    did: String,
    itemRkey: String,
    state: SavedItemState
) async throws {
    guard let current = try await getSavedItem(client: client, did: did, rkey: itemRkey) else {
        throw RecordsError.savedItemNotFound
    }

    var next = current.value
    next.state = state
    _ = try await client.putRecord(
        repo: did,
        collection: Collection.savedItem,
        rkey: itemRkey,
        record: next
    )
}

public func deleteSavedItem(
    client: any LatrRepoClient,
    did: String,
    itemRkey: String
) async throws {
    try await client.deleteRecord(
        repo: did,
        collection: Collection.savedItem,
        rkey: itemRkey
    )
}

public func deleteExternalURLSave(
    client: any LatrRepoClient,
    did: String,
    url: String,
    deleteWrapper: Bool = false
) async throws {
    guard let normalized = normalizeURL(url.trimmingCharacters(in: .whitespacesAndNewlines)) else {
        throw RecordsError.invalidURL
    }

    let externalRkey = rkeyFromNormalizedURL(normalized)
    let wrapperURI = atURIForExternal(did: did, externalRkey: externalRkey)
    let itemRkey = rkeyFromSubjectURI(wrapperURI)

    try? await client.deleteRecord(
        repo: did,
        collection: Collection.savedItem,
        rkey: itemRkey
    )

    if deleteWrapper {
        try? await client.deleteRecord(
            repo: did,
            collection: Collection.savedExternal,
            rkey: externalRkey
        )
    }
}
