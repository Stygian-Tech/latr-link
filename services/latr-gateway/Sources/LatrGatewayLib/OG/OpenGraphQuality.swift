import Foundation

public struct OpenGraphMetaSignals: Sendable, Equatable {
    public var hasExplicitTitle: Bool
    public var hasExplicitImage: Bool

    public init(hasExplicitTitle: Bool, hasExplicitImage: Bool) {
        self.hasExplicitTitle = hasExplicitTitle
        self.hasExplicitImage = hasExplicitImage
    }
}

public func openGraphNeedsReaderEnhancement(
    fields: OpenGraphFields,
    signals: OpenGraphMetaSignals?,
    pageURL: String
) -> Bool {
    if fields.image?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
        return true
    }

    if signals?.hasExplicitImage == false {
        return true
    }

    if signals?.hasExplicitTitle == false {
        return true
    }

    return isWeakOpenGraphTitle(
        fields.title,
        siteName: fields.siteName,
        pageURL: pageURL
    )
}

public func isWeakOpenGraphTitle(
    _ rawTitle: String?,
    siteName: String?,
    pageURL: String
) -> Bool {
    guard let title = rawTitle?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty
    else {
        return true
    }

    let lower = title.lowercased()
    let hostLabel = hostnameLabel(from: pageURL)?.lowercased()
    let site = siteName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

    if let site, lower == site {
        return true
    }
    if let hostLabel, lower == hostLabel {
        return true
    }

    let genericTitles = [
        "home",
        "homepage",
        "the verge",
        "verge",
        "news",
        "latest",
    ]
    if genericTitles.contains(lower) {
        return true
    }

    if let hostLabel,
       lower.hasSuffix(" | \(hostLabel)"),
       String(lower.dropLast(" | \(hostLabel)".count)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
        return true
    }

    if let site,
       lower.hasSuffix(" | \(site)"),
       String(lower.dropLast(" | \(site)".count)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
        return true
    }

    return false
}

public func mergeOpenGraphFields(primary: OpenGraphFields, fallback: OpenGraphFields) -> OpenGraphFields {
    OpenGraphFields(
        title: primary.title ?? fallback.title,
        description: primary.description ?? fallback.description,
        image: primary.image ?? fallback.image,
        siteName: primary.siteName ?? fallback.siteName,
        author: primary.author ?? fallback.author
    )
}
