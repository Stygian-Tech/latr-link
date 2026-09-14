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
        if subject.hasPrefix("at://") {
            let collection = subject.dropFirst(5).split(separator: "/").dropFirst().first?.lowercased() ?? ""
            if collection == "app.bsky.feed.post" { return .social }
            if collection.contains("standard.site") || collection.contains("site.standard") || collection.contains("whtwnd.blog") || collection.contains("blog.entry") || collection.hasSuffix(".article") { return .article }
            return .other
        }
        let url = URL(string: subject), last = url?.lastPathComponent ?? ""
        let host = url?.host?.lowercased() ?? "", path = url?.path.split(separator: "/") ?? []
        if (host == "bsky.app" || host.hasSuffix(".bsky.app")), path.count == 4, path[0] == "profile", path[2] == "post" { return .social }
        let title = preview?.title?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let author = preview?.author?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !title.isEmpty, !title.hasPrefix("saved from "),
           !author.isEmpty || path.count > 1 || last.contains("-") || last.utf16.count > 18 { return .article }
        return .other
    }
}
