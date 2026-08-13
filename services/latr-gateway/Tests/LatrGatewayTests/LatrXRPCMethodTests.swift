@testable import LatrGatewayLib
import XCTest

final class LatrXRPCMethodTests: XCTestCase {
    func testEveryMethodUsesLatrNamespace() {
        XCTAssertEqual(LatrXRPCMethod.allCases.count, 17)
        XCTAssertTrue(LatrXRPCMethod.allCases.allSatisfy { $0.rawValue.hasPrefix("link.latr.") })
    }

    func testQueryAndProcedureKindsAreStable() {
        XCTAssertEqual(LatrXRPCMethod.listItems.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.getOpenGraph.kind, .query)
        XCTAssertEqual(LatrXRPCMethod.saveURL.kind, .procedure)
        XCTAssertEqual(LatrXRPCMethod.revokeDeveloperKey.kind, .procedure)
    }

    func testOnlyDeveloperMethodsSkipApplicationCredential() {
        XCTAssertTrue(LatrXRPCMethod.listItems.requiresApplicationCredential)
        XCTAssertFalse(LatrXRPCMethod.listDeveloperClients.requiresApplicationCredential)
        XCTAssertFalse(LatrXRPCMethod.createDeveloperKey.requiresApplicationCredential)
    }
}
