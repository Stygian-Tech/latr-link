import Foundation
import LatrKit

public extension NativeLibrary {
    /// Resolve only destinations supported by the web library. Arbitrary AT records have no
    /// universal web URL; the UI can explain this and still offer their AT URI for sharing.
    func readingURL(for bookmark: BookmarkView) async throws -> URL? {
        let subject = try SharedLinkParser.validatedSubject(bookmark.subject)
        if let destination = URL(string: subject), ["https", "http"].contains(destination.scheme?.lowercased() ?? "") { return destination }
        let pieces = subject.dropFirst(5).split(separator: "/").map(String.init)
        guard pieces.count == 3 else { return nil }
        if pieces[1] == "app.bsky.feed.post" {
            var destination = URLComponents(string: "https://bsky.app")!
            destination.path = "/profile/\(pieces[0])/post/\(pieces[2])"
            return destination.url
        }
        guard ["link.latr.saved.external", "com.latr.saved.external"].contains(pieces[1]) else { return nil }
        let pds = try await oauth.publicPDSURL(for: pieces[0])
        var url = URLComponents(url: pds.appending(path: "xrpc/com.atproto.repo.getRecord"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "repo", value: pieces[0]), URLQueryItem(name: "collection", value: pieces[1]), URLQueryItem(name: "rkey", value: pieces[2])]
        let data = try await http.send(URLRequest(url: url.url!)).checked()
        guard let response = try JSONSerialization.jsonObject(with: data) as? [String: Any], let value = response["value"] as? [String: Any],
              let rawURL = value["normalizedUrl"] as? String ?? value["url"] as? String,
              let normalized = try? SharedLinkParser.validatedSubject(rawURL), let destination = URL(string: normalized),
              ["http", "https"].contains(destination.scheme?.lowercased() ?? "") else { return nil }
        return destination
    }
}
