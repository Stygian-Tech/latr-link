import Foundation

public struct MigrateLexiconsBody: Decodable, Sendable {
    public let upstreamDpopProof: String

    public init(upstreamDpopProof: String) {
        self.upstreamDpopProof = upstreamDpopProof
    }
}
