import Foundation

public enum OpenGraphMerger {
    /// Subject-derived fields win; fallback fills only empty slots.
    public static func merge(primary: OpenGraphPreview, fallback: OpenGraphPreview) -> OpenGraphPreview {
        OpenGraphPreview(
            title: filled(primary.title) ?? fallback.title,
            description: filled(primary.description) ?? fallback.description,
            image: filled(primary.image) ?? fallback.image,
            siteName: filled(primary.siteName) ?? fallback.siteName,
            author: filled(primary.author) ?? fallback.author
        )
    }

    private static func filled(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func externalSaveNeedsPreview(_ record: ExternalSave) -> Bool {
        !hasFilledString(record.title)
            || !hasFilledString(record.image)
            || !hasFilledString(record.excerpt)
            || !hasFilledString(record.site)
            || !hasFilledString(record.author)
    }

    static func savedItemNeedsPreview(_ record: SavedItem) -> Bool {
        !hasFilledString(record.previewTitle)
            || !hasFilledString(record.previewImage)
            || !hasFilledString(record.previewExcerpt)
            || !hasFilledString(record.previewSite)
            || !hasFilledString(record.previewAuthor)
    }

    private static func hasFilledString(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func merging(into existing: ExternalSave, preview: OpenGraphPreview) -> ExternalSave? {
        var merged = existing

        if let title = preview.title,
           existing.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.title = String(title.prefix(OpenGraphLimits.title))
        }
        if let description = preview.description,
           existing.excerpt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.excerpt = String(description.prefix(OpenGraphLimits.excerpt))
        }
        if let image = preview.image,
           existing.image?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.image = image
        }
        if let siteName = preview.siteName,
           existing.site?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.site = String(siteName.prefix(OpenGraphLimits.site))
        }
        if let author = preview.author,
           existing.author?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.author = String(author.prefix(OpenGraphLimits.author))
        }

        return merged == existing ? nil : merged
    }

    static func merging(into existing: SavedItem, preview: OpenGraphPreview) -> SavedItem? {
        var merged = existing

        if let title = preview.title,
           existing.previewTitle?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.previewTitle = String(title.prefix(OpenGraphLimits.title))
        }
        if let description = preview.description,
           existing.previewExcerpt?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.previewExcerpt = String(description.prefix(OpenGraphLimits.excerpt))
        }
        if let image = preview.image,
           existing.previewImage?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.previewImage = image
        }
        if let siteName = preview.siteName,
           existing.previewSite?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.previewSite = String(siteName.prefix(OpenGraphLimits.site))
        }
        if let author = preview.author,
           existing.previewAuthor?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
        {
            merged.previewAuthor = String(author.prefix(OpenGraphLimits.author))
        }

        return merged == existing ? nil : merged
    }
}
