import Crypto
import Foundation
import Logging
import PostgresNIO

public protocol BookmarkPreviewStore: Sendable {
    func preview(for subject: String) async throws -> OpenGraphFields?
    func store(_ preview: OpenGraphFields, for subject: String) async throws
}

public actor InMemoryBookmarkPreviewStore: BookmarkPreviewStore {
    private var values: [String: OpenGraphFields] = [:]
    public init() {}
    public func preview(for subject: String) -> OpenGraphFields? { values[subject] }
    public func store(_ preview: OpenGraphFields, for subject: String) { values[subject] = preview }
}

public actor PostgresBookmarkPreviewStore: BookmarkPreviewStore {
    private let pool: PostgresClient
    private let logger: Logger

    public init(pool: PostgresClient, logger: Logger) {
        self.pool = pool; self.logger = logger
    }

    public func preview(for subject: String) async throws -> OpenGraphFields? {
        let rows = try await pool.query(
            """
            SELECT title, description, image_url, site_name, author
            FROM bookmark_previews
            WHERE subject_hash = \(subjectHash(subject)) AND expires_at > NOW()
            """,
            logger: logger
        )
        for try await row in rows {
            let (title, description, image, siteName, author) = try row.decode((String?, String?, String?, String?, String?).self)
            return OpenGraphFields(title: title, description: description, image: image, siteName: siteName, author: author)
        }
        return nil
    }

    public func store(_ preview: OpenGraphFields, for subject: String) async throws {
        _ = try await pool.query(
            """
            INSERT INTO bookmark_previews (subject_hash, subject, title, description, image_url, site_name, author, updated_at, expires_at)
            VALUES (\(subjectHash(subject)), \(subject), \(preview.title), \(preview.description), \(preview.image), \(preview.siteName), \(preview.author), NOW(), NOW() + INTERVAL '7 days')
            ON CONFLICT (subject_hash) DO UPDATE SET
                subject = EXCLUDED.subject,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                image_url = EXCLUDED.image_url,
                site_name = EXCLUDED.site_name,
                author = EXCLUDED.author,
                updated_at = NOW(),
                expires_at = NOW() + INTERVAL '7 days'
            """,
            logger: logger
        )
    }
}

private func subjectHash(_ subject: String) -> String {
    SHA256.hash(data: Data(subject.utf8)).map { String(format: "%02x", $0) }.joined()
}
