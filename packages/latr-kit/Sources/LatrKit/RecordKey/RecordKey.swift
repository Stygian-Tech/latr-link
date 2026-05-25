import Crypto
import Foundation

/// Deterministic ATProto record keys for L@tr collections.
public enum RecordKey {
    private static let base32Alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

    public static func key(forNormalizedURL url: String) -> String {
        digestKey(for: url)
    }

    public static func key(forSubjectURI uri: String) -> String {
        digestKey(for: uri)
    }

    public static func fingerprint(forNormalizedURL url: String) -> String {
        let hash = SHA256.hash(data: Data(url.utf8))
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private static func digestKey(for text: String) -> String {
        let hash = SHA256.hash(data: Data(text.utf8))
        return encodeBase32(Array(hash))
    }

    private static func encodeBase32(_ buffer: [UInt8]) -> String {
        var bits = 0
        var value = 0
        var out = ""
        for byte in buffer {
            value = (value << 8) | Int(byte)
            bits += 8
            while bits >= 5 {
                out.append(base32Alphabet[(value >> (bits - 5)) & 31])
                bits -= 5
            }
        }
        if bits > 0 {
            out.append(base32Alphabet[(value << (5 - bits)) & 31])
        }
        return out
    }
}

public enum ATURI {
    public static func externalSave(repositoryDID: String, recordKey: String) -> String {
        "at://\(repositoryDID)/\(LexiconCollection.external.identifier)/\(recordKey)"
    }
}

enum Timestamp {
    static func iso8601Now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
