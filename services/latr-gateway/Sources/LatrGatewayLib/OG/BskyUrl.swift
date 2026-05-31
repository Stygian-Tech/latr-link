import Foundation

public struct BskyProfilePostParts: Sendable, Equatable {
    public let actor: String
    public let rkey: String

    public init(actor: String, rkey: String) {
        self.actor = actor
        self.rkey = rkey
    }
}

public func extractBskyAppProfilePostParts(from url: URL) -> BskyProfilePostParts? {
    let host = (url.host ?? "").lowercased()
    guard host == "bsky.app" || host.hasSuffix(".bsky.app") else { return nil }

    let segments = url.path.split(separator: "/").map(String.init)
    guard segments.count == 4,
          segments[0] == "profile",
          segments[2] == "post"
    else {
        return nil
    }

    let actor = segments[1].removingPercentEncoding?.trimmingCharacters(in: .whitespacesAndNewlines) ?? segments[1]
    let rkey = segments[3].removingPercentEncoding?.trimmingCharacters(in: .whitespacesAndNewlines) ?? segments[3]
    guard !actor.isEmpty, !rkey.isEmpty else { return nil }
    return BskyProfilePostParts(actor: actor, rkey: rkey)
}

public func bskyPostSubjectURI(actor: String, rkey: String, did: String) -> String {
    "at://\(did)/app.bsky.feed.post/\(rkey)"
}
