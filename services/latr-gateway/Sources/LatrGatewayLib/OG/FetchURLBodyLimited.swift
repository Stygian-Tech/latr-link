import AsyncHTTPClient
import Foundation
import NIOCore

private let userAgent =
    "Mozilla/5.0 (compatible; L@tr.link/1.0; +https://latr.link) AppleWebKit/537.36 (KHTML, like Gecko)"
private let fetchTimeoutSeconds: Int64 = 10
private let maxRedirects = 5

public enum FetchURLResult: Sendable {
    case success(text: String, finalURL: String)
    case failure(reason: String)
}

public func fetchURLBodyLimited(
    target: String,
    maxBytes: Int,
    accept: String = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    httpClient: HTTPClient
) async -> FetchURLResult {
    guard var currentURL = URL(string: target) else {
        return .failure(reason: "invalid_url")
    }

    guard let scheme = currentURL.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
        return .failure(reason: "unsupported_scheme")
    }

    if let block = blockingReasonOGFetch(currentURL.host ?? "") {
        return .failure(reason: block)
    }

    do {
        for _ in 0 ... maxRedirects {
            var request = HTTPClientRequest(url: currentURL.absoluteString)
            request.headers.add(name: "Accept", value: accept)
            request.headers.add(name: "User-Agent", value: userAgent)

            let response = try await httpClient.execute(request, timeout: .seconds(fetchTimeoutSeconds))

            if [301, 302, 303, 307, 308].contains(response.status.code),
               let location = response.headers.first(name: "Location"),
               let nextURL = URL(string: location, relativeTo: currentURL)
            {
                currentURL = nextURL
                if blockingReasonOGFetch(currentURL.host ?? "") != nil {
                    return .failure(reason: "blocked_redirect")
                }
                continue
            }

            guard (200 ... 299).contains(response.status.code) else {
                return .failure(reason: "http_\(response.status.code)")
            }

            var body = try await response.body.collect(upTo: maxBytes + 1)
            if body.readableBytes > maxBytes {
                body = body.getSlice(at: body.readerIndex, length: maxBytes) ?? body
            }

            let text = String(decoding: Data(buffer: body), as: UTF8.self)
            return .success(text: text, finalURL: currentURL.absoluteString)
        }

        return .failure(reason: "too_many_redirects")
    } catch {
        let message = String(describing: error)
        if message.localizedCaseInsensitiveContains("timeout") {
            return .failure(reason: "timeout")
        }
        return .failure(reason: "fetch_error")
    }
}
