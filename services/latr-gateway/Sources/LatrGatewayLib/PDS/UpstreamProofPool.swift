import Foundation

/// Consumes one client-minted upstream DPoP proof per matching PDS XRPC call.
final class UpstreamProofPool: @unchecked Sendable {
    private let lock = NSLock()
    private var proofs: [String]

    init(rawHeader: String?) {
        if let raw = rawHeader?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            proofs = raw.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        } else {
            proofs = []
        }
    }

    func consume(forXrpcMethod method: String, httpMethod: String, pdsBase: String) -> (proof: String, url: String)? {
        lock.lock()
        defer { lock.unlock() }

        let normalizedPDSBase = pdsBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        for (index, proof) in proofs.enumerated() {
            guard let htu = decodeJWTClaimString(proof, claim: "htu"),
                  let htm = decodeJWTClaimString(proof, claim: "htm"),
                  htm.uppercased() == httpMethod.uppercased()
            else {
                continue
            }

            let normalized = htu.split(separator: "?").first.map(String.init) ?? htu
            guard normalized.hasPrefix("\(normalizedPDSBase)/xrpc/") else { continue }
            guard normalized.hasSuffix("/xrpc/\(method)") else { continue }

            proofs.remove(at: index)
            return (proof, normalized)
        }

        return nil
    }
}

private func decodeJWTClaimString(_ jwt: String, claim: String) -> String? {
    guard let data = base64URLDecode(String(jwt.split(separator: ".", omittingEmptySubsequences: false).dropFirst().first ?? "")),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let value = json[claim] as? String
    else {
        return nil
    }
    return value
}
