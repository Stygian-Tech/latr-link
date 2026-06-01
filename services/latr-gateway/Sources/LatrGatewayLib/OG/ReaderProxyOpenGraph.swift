import AsyncHTTPClient
import Foundation

private let readerProxyPrefix = "https://r.jina.ai/"

func fetchOpenGraphViaReaderProxy(url: String, httpClient: HTTPClient) async -> OpenGraphFields? {
    let proxyURL = readerProxyPrefix + url
    switch await fetchURLBodyLimited(
        target: proxyURL,
        maxBytes: 256 * 1024,
        accept: "text/plain,*/*",
        httpClient: httpClient
    ) {
    case let .success(text, _):
        return parseReaderProxyResponse(text, sourceURL: url)
    case .failure:
        return nil
    }
}

public func parseReaderProxyResponse(_ text: String, sourceURL: String) -> OpenGraphFields? {
    var title: String?
    var description: String?

    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("Title: ") {
            title = String(trimmed.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
        } else if trimmed.hasPrefix("Description: ") {
            description = String(trimmed.dropFirst(13)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    if title == nil || title?.isEmpty == true {
        if let markdownRange = text.range(of: "Markdown Content:") {
            let markdown = text[markdownRange.upperBound...]
            for line in markdown.split(separator: "\n", maxSplits: 20, omittingEmptySubsequences: true) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.hasPrefix("# ") {
                    title = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                    break
                }
            }
        }
    }

    let siteName = hostnameLabel(from: sourceURL)
    guard title?.isEmpty == false || siteName != nil else { return nil }

    return OpenGraphFields(
        title: title?.isEmpty == false ? title : siteName,
        description: description?.isEmpty == false ? description : nil,
        siteName: siteName
    )
}
