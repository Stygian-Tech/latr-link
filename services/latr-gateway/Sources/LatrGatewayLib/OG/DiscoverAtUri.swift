import AsyncHTTPClient
import Foundation

private let maxHTMLBytes = 512 * 1024

public func discoverAtURIFromURL(
    _ rawURL: String,
    httpClient: HTTPClient,
    subjectClient: FederatedSubjectClient
) async -> DiscoverAtURIResult {
    guard let pageURL = URL(string: rawURL) else {
        return DiscoverAtURIResult(subjectUri: nil, warning: "invalid_url")
    }

    guard let scheme = pageURL.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
        return DiscoverAtURIResult(subjectUri: nil, warning: "unsupported_scheme")
    }

    if let block = blockingReasonOGFetch(pageURL.host ?? "") {
        return DiscoverAtURIResult(subjectUri: nil, warning: block)
    }

    let appView = subjectClient
    if let profilePost = extractBskyAppProfilePostParts(from: pageURL),
       let did = await appView.resolveActorDID(profilePost.actor)
    {
        return DiscoverAtURIResult(
            subjectUri: bskyPostSubjectURI(
                actor: profilePost.actor,
                rkey: profilePost.rkey,
                did: did
            )
        )
    }

    switch await fetchURLBodyLimited(target: pageURL.absoluteString, maxBytes: maxHTMLBytes, httpClient: httpClient) {
    case let .success(text, _):
        if let fromHead = extractAtUriFromHead(text) {
            return DiscoverAtURIResult(subjectUri: fromHead)
        }
        return DiscoverAtURIResult(subjectUri: nil)
    case let .failure(reason):
        return DiscoverAtURIResult(subjectUri: nil, warning: reason)
    }
}

public func fetchOpenGraphMetadata(url: String, httpClient: HTTPClient) async -> OpenGraphFields? {
    await resolveOpenGraphForURL(url: url, httpClient: httpClient)
}
