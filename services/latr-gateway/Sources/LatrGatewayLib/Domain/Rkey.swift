import CryptoKit
import Foundation

private let base32Alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")

/// RFC 4648 base32 (no padding), using the standard alphabet.
public func bytesToBase32Upper(_ buffer: [UInt8]) -> String {
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

public func sha256UTF8(_ text: String) -> [UInt8] {
    let data = Data(text.utf8)
    let digest = SHA256.hash(data: data)
    return Array(digest)
}

public func rkeyFromNormalizedURL(_ normalizedURL: String) -> String {
    bytesToBase32Upper(sha256UTF8(normalizedURL))
}

public func rkeyFromSubjectURI(_ subjectURI: String) -> String {
    bytesToBase32Upper(sha256UTF8(subjectURI))
}

public func fingerprintHex(_ buffer: [UInt8]) -> String {
    buffer.map { String(format: "%02x", $0) }.joined()
}

public func fingerprintFromNormalizedURL(_ normalizedURL: String) -> String {
    fingerprintHex(sha256UTF8(normalizedURL))
}

public func atURIForExternal(did: String, externalRkey: String) -> String {
    "at://\(did)/\(Collection.savedExternal)/\(externalRkey)"
}

public func iso8601Now() -> String {
    ISO8601DateFormatter().string(from: Date())
}
