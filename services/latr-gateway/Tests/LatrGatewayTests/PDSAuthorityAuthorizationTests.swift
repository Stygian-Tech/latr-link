import AsyncHTTPClient
import Foundation
import LatrKit
@testable import LatrGatewayLib
import XCTest

final class PDSAuthorityAuthorizationTests: XCTestCase {
    private let viewerDID = "did:plc:viewer"
    private let pdsBase = "https://pds.example"

    func testUnverifiedTokenCanListRecordsWithMatchingUpstreamProof() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.repo.listRecords"
        )
        let recorder = PDSRequestRecorder(
            response: (200, Data(#"{"records":[]}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        let page: RecordList<TestRecord> = try await client.listRecords(
            in: viewerDID,
            collection: .savedItem,
            limit: 25,
            startingAfter: nil
        )

        XCTAssertTrue(page.records.isEmpty)
        let calls = await recorder.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.method, .get)
        XCTAssertEqual(calls.first?.authorization, "DPoP access-token")
        XCTAssertEqual(calls.first?.dpopProof, proof)
        XCTAssertEqual(
            URLComponents(string: calls.first?.url ?? "")?.path,
            "/xrpc/com.atproto.repo.listRecords"
        )
        try await httpClient.shutdown()
    }

    func testUnverifiedTokenCanCreateRecordWithMatchingUpstreamProof() async throws {
        let proof = upstreamProof(
            htm: "POST",
            htu: "\(pdsBase)/xrpc/com.atproto.repo.createRecord"
        )
        let recorder = PDSRequestRecorder(
            response: (200, Data(#"{"uri":"at://did:plc:viewer/link.latr.saved.item/test"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        let response = try await client.createRecord(
            in: viewerDID,
            collection: .savedItem,
            withKey: "test",
            value: TestRecord(value: "saved")
        )

        XCTAssertEqual(response.uri, "at://did:plc:viewer/link.latr.saved.item/test")
        let calls = await recorder.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.method, .post)
        XCTAssertEqual(calls.first?.authorization, "DPoP access-token")
        XCTAssertEqual(calls.first?.dpopProof, proof)
        XCTAssertNotNil(calls.first?.body)
        try await httpClient.shutdown()
    }

    func testUnverifiedTokenWithoutUpstreamProofCannotListRecords() async throws {
        let recorder = PDSRequestRecorder(
            response: (200, Data(#"{"records":[]}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: nil, recorder: recorder)

        await assertGatewayError(code: "missing_upstream_dpop") {
            let _: RecordList<TestRecord> = try await client.listRecords(
                in: self.viewerDID,
                collection: .savedItem,
                limit: 25,
                startingAfter: nil
            )
        }

        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 0)
        try await httpClient.shutdown()
    }

    func testUnverifiedTokenWithIncorrectlyBoundProofCannotMutateRecords() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.repo.createRecord"
        )
        let recorder = PDSRequestRecorder(
            response: (200, Data(#"{"uri":"at://did:plc:viewer/link.latr.saved.item/test"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "missing_upstream_dpop") {
            _ = try await client.createRecord(
                in: self.viewerDID,
                collection: .savedItem,
                withKey: "test",
                value: TestRecord(value: "saved")
            )
        }

        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 0)
        try await httpClient.shutdown()
    }

    func testPDSRejectionOfUnverifiedTokenCannotReturnRecords() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.repo.listRecords"
        )
        let recorder = PDSRequestRecorder(
            response: (401, Data(#"{"error":"InvalidToken"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "pds_unauthorized") {
            let _: RecordList<TestRecord> = try await client.listRecords(
                in: self.viewerDID,
                collection: .savedItem,
                limit: 25,
                startingAfter: nil
            )
        }

        let calls = await recorder.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.dpopProof, proof)
        try await httpClient.shutdown()
    }

    func testPDSRejectionOfUnverifiedTokenCannotCompleteMutation() async throws {
        let proof = upstreamProof(
            htm: "POST",
            htu: "\(pdsBase)/xrpc/com.atproto.repo.createRecord"
        )
        let recorder = PDSRequestRecorder(
            response: (403, Data(#"{"error":"InsufficientScope"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "pds_forbidden") {
            _ = try await client.createRecord(
                in: self.viewerDID,
                collection: .savedItem,
                withKey: "test",
                value: TestRecord(value: "saved")
            )
        }

        let calls = await recorder.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.dpopProof, proof)
        try await httpClient.shutdown()
    }

    private func makeClient(
        proof: String?,
        recorder: PDSRequestRecorder
    ) -> (PDSRepositoryClient, HTTPClient) {
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let client = PDSRepositoryClient(
            auth: AuthContext(
                did: viewerDID,
                authorizationHeader: "DPoP access-token",
                dpopProof: "gateway.dpop.proof",
                upstreamDpopProof: proof,
                accessTokenSignatureVerified: false
            ),
            plcURL: "https://plc.directory",
            httpClient: httpClient,
            fetchData: { [pdsBase = pdsBase] url in
                XCTAssertEqual(url.absoluteString, "https://plc.directory/did%3Aplc%3Aviewer")
                return try JSONSerialization.data(withJSONObject: [
                    "service": [[
                        "id": "#atproto_pds",
                        "type": "AtprotoPersonalDataServer",
                        "serviceEndpoint": pdsBase,
                    ]],
                ])
            },
            executeRequest: { request in
                await recorder.execute(request)
            }
        )
        return (client, httpClient)
    }

    private func upstreamProof(htm: String, htu: String) -> String {
        let header = Data(#"{"alg":"ES256","typ":"dpop+jwt"}"#.utf8).base64URLEncodedString()
        let payload = try! JSONSerialization.data(withJSONObject: ["htm": htm, "htu": htu])
        return "\(header).\(payload.base64URLEncodedString()).signature"
    }

    private func assertGatewayError(
        code: String,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            XCTFail("Expected GatewayError with code \(code)")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, code)
        } catch {
            XCTFail("Expected GatewayError, got \(error)")
        }
    }
}

private struct TestRecord: Codable, Sendable {
    let value: String
}

private actor PDSRequestRecorder {
    private(set) var calls: [PDSRequestExecution] = []
    private let response: (statusCode: Int, body: Data)

    init(response: (statusCode: Int, body: Data)) {
        self.response = response
    }

    func execute(_ request: PDSRequestExecution) -> (statusCode: Int, body: Data) {
        calls.append(request)
        return response
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
