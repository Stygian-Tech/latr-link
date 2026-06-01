import AsyncHTTPClient
import Foundation
import NIOCore

/// Browser-like UA — many sites omit or block OG tags for obvious bot user agents.
public let ogFetchUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

private let fetchTimeoutSeconds: Int64 = 15
private let maxRedirects = 8

public func fetchURLBodyLimited(
    target: String,
    maxBytes: Int,
    accept: String = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
    httpClient: HTTPClient
) async -> FetchURLResult {
    let trimmed = target.trimmingCharacters(in: .whitespacesAndNewlines)
    guard var currentURL = URL(string: trimmed) else {
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
            request.headers.add(name: "Accept-Language", value: "en-US,en;q=0.9")
            request.headers.add(name: "Cache-Control", value: "no-cache")
            request.headers.add(name: "User-Agent", value: ogFetchUserAgent)
            if let scheme = currentURL.scheme, let host = currentURL.host {
                let portSuffix = currentURL.port.map { ":\($0)" } ?? ""
                request.headers.add(name: "Referer", value: "\(scheme)://\(host)\(portSuffix)/")
            }
            request.headers.add(name: "Sec-Fetch-Dest", value: "document")
            request.headers.add(name: "Sec-Fetch-Mode", value: "navigate")
            request.headers.add(name: "Sec-Fetch-Site", value: "none")
            request.headers.add(name: "Sec-Fetch-User", value: "?1")
            request.headers.add(name: "Upgrade-Insecure-Requests", value: "1")

            let response = try await httpClient.execute(request, timeout: .seconds(fetchTimeoutSeconds))

            if [301, 302, 303, 307, 308].contains(response.status.code),
               let location = response.headers.first(name: "Location"),
               let nextURL = URL(string: location, relativeTo: currentURL)?.absoluteURL
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
