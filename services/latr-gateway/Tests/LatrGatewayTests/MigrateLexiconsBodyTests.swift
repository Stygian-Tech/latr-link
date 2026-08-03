import Foundation
import LatrGatewayLib
import Testing

@Suite("Migrate lexicons body decoding")
struct MigrateLexiconsBodyTests {
    @Test("Decodes the upstream proof pool")
    func decodesUpstreamProofPool() throws {
        let data = Data(#"{"upstreamDpopProof":"one.two.three,four.five.six"}"#.utf8)
        let body = try JSONDecoder().decode(MigrateLexiconsBody.self, from: data)

        #expect(body.upstreamDpopProof == "one.two.three,four.five.six")
    }
}
