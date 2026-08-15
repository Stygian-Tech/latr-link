struct MigrateBookmarksBody: Decodable, LatrXRPCInput {
    static let allowedKeys: Set<String> = ["limit", "cursor", "upstreamDpopProof"]
    let limit: Int?
    let cursor: String?
    let upstreamDpopProof: String?
}
