import AsyncHTTPClient
import Foundation
import Logging

private let maxHTMLBytes = 512 * 1024
private let ogResolverLogger = Logger(label: "latr-gateway.og")

public func resolveOpenGraphForURL(
    url: String,
    httpClient: HTTPClient,
    prefetchedHTML: String? = nil,
    prefetchedFinalURL: String? = nil
) async -> OpenGraphFields? {
    let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let parsed = URL(string: trimmed),
          let scheme = parsed.scheme?.lowercased(),
          scheme == "http" || scheme == "https"
    else {
        return nil
    }

    var resolvedURL = prefetchedFinalURL ?? trimmed

    if let html = prefetchedHTML, !html.isEmpty {
        let fields = enrichOpenGraphFields(
            parseOpenGraphFromHeadOnly(html: html, resolvedPageURL: resolvedURL),
            resolvedPageURL: resolvedURL
        )
        if fields.hasAnyValue {
            return fields
        }
    }

    if prefetchedHTML == nil || prefetchedHTML?.isEmpty == true {
        switch await fetchURLBodyLimited(target: trimmed, maxBytes: maxHTMLBytes, httpClient: httpClient) {
        case let .success(text, finalURL):
            resolvedURL = finalURL
            let fields = enrichOpenGraphFields(
                parseOpenGraphMarkup(html: text, resolvedPageURL: finalURL),
                resolvedPageURL: finalURL
            )
            if fields.hasAnyValue {
                return fields
            }
            ogResolverLogger.info(
                "OG parse returned no usable fields",
                metadata: ["url": .string(trimmed), "finalUrl": .string(finalURL)]
            )
        case let .failure(reason):
            ogResolverLogger.warning(
                "OG fetch failed",
                metadata: ["url": .string(trimmed), "reason": .string(reason)]
            )
        }
    }

    if let proxyFields = await fetchOpenGraphViaReaderProxy(url: trimmed, httpClient: httpClient),
       proxyFields.hasAnyValue
    {
        ogResolverLogger.info(
            "OG resolved via reader proxy",
            metadata: ["url": .string(trimmed)]
        )
        return enrichOpenGraphFields(proxyFields, resolvedPageURL: trimmed)
    }

    ogResolverLogger.info(
        "OG using degraded URL fallback",
        metadata: ["url": .string(trimmed)]
    )
    return enrichOpenGraphFields(degradedOpenGraphFields(from: trimmed), resolvedPageURL: trimmed)
}
