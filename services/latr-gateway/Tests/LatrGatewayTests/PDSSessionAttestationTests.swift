import AsyncHTTPClient
import Foundation
@testable import LatrGatewayLib
import XCTest

final class PDSSessionAttestationTests: XCTestCase {
    private let viewerDID = "did:plc:viewer"
    private let pdsBase = "https://pds.example"

    func testUnverifiedTokenAttestsSessionWithForwardedAuthorizationAndMatchingProof() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.server.getSession"
        )
        let recorder = SessionRequestRecorder(
            response: (200, Data(#"{"did":"did:plc:viewer"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        try await client.attestOAuthSession()

        let calls = await recorder.calls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.url, "\(pdsBase)/xrpc/com.atproto.server.getSession")
        XCTAssertEqual(calls.first?.authorization, "DPoP access-token")
        XCTAssertEqual(calls.first?.dpopProof, proof)
        try await httpClient.shutdown()
    }

    func testMissingUpstreamProofIsRejectedBeforePDSRequest() async throws {
        let recorder = SessionRequestRecorder(
            response: (200, Data(#"{"did":"did:plc:viewer"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: nil, recorder: recorder)

        await assertGatewayError(code: "missing_upstream_dpop") {
            try await client.attestOAuthSession()
        }
        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 0)
        try await httpClient.shutdown()
    }

    func testIncorrectlyBoundUpstreamProofIsRejectedBeforePDSRequest() async throws {
        let proof = upstreamProof(
            htm: "POST",
            htu: "\(pdsBase)/xrpc/com.atproto.server.getSession"
        )
        let recorder = SessionRequestRecorder(
            response: (200, Data(#"{"did":"did:plc:viewer"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "missing_upstream_dpop") {
            try await client.attestOAuthSession()
        }
        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 0)
        try await httpClient.shutdown()
    }

    func testPDSNonceOrProofRejectionFailsAttestation() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.server.getSession"
        )
        let recorder = SessionRequestRecorder(
            response: (401, Data(#"{"error":"use_dpop_nonce"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "invalid_upstream_dpop") {
            try await client.attestOAuthSession()
        }
        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 1)
        try await httpClient.shutdown()
    }

    func testConsumedProofCannotBeReplayed() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.server.getSession"
        )
        let recorder = SessionRequestRecorder(
            response: (200, Data(#"{"did":"did:plc:viewer"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        try await client.attestOAuthSession()
        await assertGatewayError(code: "missing_upstream_dpop") {
            try await client.attestOAuthSession()
        }
        let callCount = await recorder.calls.count
        XCTAssertEqual(callCount, 1)
        try await httpClient.shutdown()
    }

    func testSessionDIDMustMatchAccessTokenSubject() async throws {
        let proof = upstreamProof(
            htm: "GET",
            htu: "\(pdsBase)/xrpc/com.atproto.server.getSession"
        )
        let recorder = SessionRequestRecorder(
            response: (200, Data(#"{"did":"did:plc:attacker"}"#.utf8))
        )
        let (client, httpClient) = makeClient(proof: proof, recorder: recorder)

        await assertGatewayError(code: "pds_session_did_mismatch") {
            try await client.attestOAuthSession()
        }
        try await httpClient.shutdown()
    }

    func testLocallyVerifiedTokenBypassesPDSAttestationForBothStrictRoutes() async throws {
        let auth = authContext(signatureVerified: true, upstreamProof: nil)
        let counter = AttestationCounter()

        for path in [
            "/v1/latr/og-preview",
            "/v1/latr/discover/at-uri",
            "/xrpc/link.latr.preview.getOpenGraph",
            "/xrpc/link.latr.discovery.resolveUrl",
        ] {
            try await attestPDSOAuthSessionIfNeeded(auth: auth, path: path) {
                await counter.increment()
            }
        }

        let count = await counter.value
        XCTAssertEqual(count, 0)
    }

    func testUnverifiedDeveloperTokenRequiresPDSAttestation() async throws {
        let auth = authContext(signatureVerified: false, upstreamProof: "proof")
        let counter = AttestationCounter()

        try await attestDeveloperOAuthSessionIfNeeded(auth: auth) {
            await counter.increment()
        }

        let count = await counter.value
        XCTAssertEqual(count, 1)
    }

    func testLocallyVerifiedDeveloperTokenBypassesPDSAttestation() async throws {
        let auth = authContext(signatureVerified: true, upstreamProof: nil)
        let counter = AttestationCounter()

        try await attestDeveloperOAuthSessionIfNeeded(auth: auth) {
            await counter.increment()
        }

        let count = await counter.value
        XCTAssertEqual(count, 0)
    }

    func testDeveloperAttestationFailureIsPropagated() async throws {
        let auth = authContext(signatureVerified: false, upstreamProof: "proof")

        await assertGatewayError(code: "invalid_upstream_dpop") {
            try await attestDeveloperOAuthSessionIfNeeded(auth: auth) {
                throw GatewayError(
                    status: .unauthorized,
                    message: "PDS rejected OAuth session attestation",
                    code: "invalid_upstream_dpop"
                )
            }
        }
    }

    private func makeClient(
        proof: String?,
        recorder: SessionRequestRecorder
    ) -> (PDSRepositoryClient, HTTPClient) {
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let client = PDSRepositoryClient(
            auth: authContext(signatureVerified: false, upstreamProof: proof),
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
                XCTAssertEqual(request.method, .get)
                XCTAssertNil(request.body)
                return await recorder.execute(
                    url: request.url,
                    authorization: request.authorization ?? "",
                    dpopProof: request.dpopProof ?? ""
                )
            }
        )
        return (client, httpClient)
    }

    private func authContext(
        signatureVerified: Bool,
        upstreamProof: String?
    ) -> AuthContext {
        AuthContext(
            did: viewerDID,
            authorizationHeader: "DPoP access-token",
            dpopProof: "gateway.dpop.proof",
            upstreamDpopProof: upstreamProof,
            accessTokenSignatureVerified: signatureVerified
        )
    }

    private func upstreamProof(htm: String, htu: String) -> String {
        let header = Data(#"{"alg":"ES256","typ":"dpop+jwt"}"#.utf8).base64URLEncodedString()
        let payloadObject = ["htm": htm, "htu": htu]
        let payloadData = try! JSONSerialization.data(withJSONObject: payloadObject)
        return "\(header).\(payloadData.base64URLEncodedString()).signature"
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

private actor SessionRequestRecorder {
    struct Call: Sendable {
        let url: String
        let authorization: String
        let dpopProof: String
    }

    private(set) var calls: [Call] = []
    private let response: (statusCode: Int, body: Data)

    init(response: (statusCode: Int, body: Data)) {
        self.response = response
    }

    func execute(
        url: String,
        authorization: String,
        dpopProof: String
    ) -> (statusCode: Int, body: Data) {
        calls.append(Call(url: url, authorization: authorization, dpopProof: dpopProof))
        return response
    }
}

private actor AttestationCounter {
    private(set) var value = 0

    func increment() {
        value += 1
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
