import Foundation

/// Swift String equality is canonically equivalent; protocol tags use exact UTF-8 identity.
struct ExactTag: Identifiable {
    let value: String
    var id: Data { Data(value.utf8) }
    init(_ value: String) { self.value = value }
    static func equal(_ left: String, _ right: String) -> Bool { left.utf8.elementsEqual(right.utf8) }
    static func unique(_ values: [String]) -> [String] {
        var seen = Set<Data>()
        return values.filter { seen.insert(Data($0.utf8)).inserted }
    }
}
