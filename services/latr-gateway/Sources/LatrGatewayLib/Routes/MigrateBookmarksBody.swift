struct MigrateBookmarksBody: Decodable {
    let limit: Int?
    let cursor: String?
    let upstreamDpopProof: String?
}
