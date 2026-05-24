import Foundation

public func externalNeedsOGEnrichment(_ record: SavedExternalRecord) -> Bool {
    !(record.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        && record.image?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
}

public func savedItemNeedsOGEnrichment(_ record: SavedItemRecord) -> Bool {
    !(record.previewTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        && record.previewImage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
}

private func sliceField(_ value: String, max: Int) -> String {
    String(value.prefix(max))
}

public func applyOGToExternal(
    existing: SavedExternalRecord,
    og: OpenGraphMetadata
) -> SavedExternalRecord? {
    var merged = existing

    if let title = og.title, existing.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
        merged.title = sliceField(title, max: OGFieldMax.title)
    }
    if let description = og.description,
       existing.excerpt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.excerpt = sliceField(description, max: OGFieldMax.excerpt)
    }
    if let image = og.image, existing.image?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
        merged.image = image
    }
    if let siteName = og.siteName, existing.site?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
        merged.site = sliceField(siteName, max: OGFieldMax.site)
    }
    if let author = og.author, existing.author?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
        merged.author = sliceField(author, max: OGFieldMax.author)
    }

    return merged == existing ? nil : merged
}

public func applyOGToSavedItem(
    existing: SavedItemRecord,
    og: OpenGraphMetadata
) -> SavedItemRecord? {
    var merged = existing

    if let title = og.title,
       existing.previewTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.previewTitle = sliceField(title, max: OGFieldMax.title)
    }
    if let description = og.description,
       existing.previewExcerpt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.previewExcerpt = sliceField(description, max: OGFieldMax.excerpt)
    }
    if let image = og.image,
       existing.previewImage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.previewImage = image
    }
    if let siteName = og.siteName,
       existing.previewSite?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.previewSite = sliceField(siteName, max: OGFieldMax.site)
    }
    if let author = og.author,
       existing.previewAuthor?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    {
        merged.previewAuthor = sliceField(author, max: OGFieldMax.author)
    }

    return merged == existing ? nil : merged
}
