import Foundation
import LatrKit

public enum NativeContentKind: String, Codable, Sendable { case article, social, other }

public extension BookmarkView {
    var nativeDisplayTitle: String { preview?.title.flatMap { $0.isEmpty ? nil : $0 } ?? value.subject }
    var estimatedReadingMinutes: Int {
        max(2, min(12, Int((Double((nativeDisplayTitle + " " + (preview?.description ?? "")).utf16.count) / 140).rounded()) + 2))
    }
    var nativeContentKind: NativeContentKind {
        let subject = value.subject
        if subject.contains("/app.bsky.feed.post/") || (URL(string: subject)?.host == "bsky.app" && subject.contains("/post/")) { return .social }
        if subject.hasPrefix("at://") {
            let collection = subject.dropFirst(5).split(separator: "/").dropFirst().first?.lowercased() ?? ""
            if collection.contains("standard.site") || collection.contains("site.standard") || collection.contains("whtwnd.blog") || collection.contains("blog.entry") || collection.hasSuffix(".article") { return .article }
        }
        let url = URL(string: subject), last = url?.lastPathComponent ?? ""
        if !nativeDisplayTitle.lowercased().hasPrefix("saved from "), preview?.title != nil,
           preview?.author?.isEmpty == false || (url?.pathComponents.count ?? 0) > 2 || last.contains("-") || last.count > 18 { return .article }
        return .other
    }
}
