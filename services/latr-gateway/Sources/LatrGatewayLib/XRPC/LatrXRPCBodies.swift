import Foundation
import LatrKit

public protocol LatrXRPCInput: Decodable {
    static var allowedKeys: Set<String> { get }
}

extension LatrSaveBookmarkInput: LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["subject", "tags"]
}

extension LatrSyncBookmarkMetadataInput: LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["limit", "cursor"]
}

extension LatrSetBookmarkStateInput: LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["bookmarkUri", "state"]
}

extension LatrDeleteBookmarkInput: LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["bookmarkUri"]
}

public struct SaveURLInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["url"]
    public let url: String
}

public struct SaveSubjectInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["subjectUri", "linkedWebUrl"]
    public let subjectUri: String
    public let linkedWebUrl: String?
}

public struct SetSavedItemStateInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["itemRkey", "state"]
    public let itemRkey: String
    public let state: SavedItemState
}

public struct DeleteSavedItemInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["itemRkey"]
    public let itemRkey: String
}

public struct EmptyXRPCInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = []
    public init() {}
}

public struct DeleteDeveloperClientInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["clientId"]
    public let clientId: String
}

public struct ListDeveloperKeysParameters: Sendable {
    public let clientId: String
}

public struct CreateDeveloperKeyInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["clientId", "label"]
    public let clientId: String
    public let label: String?
}

public struct RevokeDeveloperKeyInput: Codable, Sendable, LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["clientId", "keyId"]
    public let clientId: String
    public let keyId: String
}

extension CreateDeveloperClientBody: LatrXRPCInput {
    public static let allowedKeys: Set<String> = ["clientId", "displayName"]
}
