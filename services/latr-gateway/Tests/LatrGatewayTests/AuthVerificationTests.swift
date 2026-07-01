import AsyncHTTPClient
import Crypto
import Foundation
import Hummingbird
@testable import LatrGatewayLib
import NIOCore
import XCTest

final class AuthVerificationTests: XCTestCase {
    func testDPoPRejectsUnsignedProofThatUsedToPassStructureCheck() throws {
        let token = unsignedAccessToken()
        let proof = unsignedProof(
            htm: "GET",
            htu: "https://api.testing.latr.link/v1/latr/saves",
            accessToken: token
        )

        XCTAssertThrowsError(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(path: "/v1/latr/saves")
            )
        )
    }

    func testDPoPRejectsWrongRequestBinding() throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let proof = try signedDPoP(
            signingKey: key,
            jwk: jwk,
            htm: "POST",
            htu: "https://api.testing.latr.link/v1/latr/saves",
            accessToken: token
        )

        XCTAssertThrowsError(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(path: "/v1/latr/saves")
            )
        )
    }

    func testOAuthVerifierRejectsTamperedAccessTokenSignature() async throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let tampered = "\(token)a"
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    let jwks = #"{"keys":[{"kty":"EC","kid":"test-key","crv":"P-256","x":"\#(jwk.x)","y":"\#(jwk.y)"}]}"#
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        do {
            _ = try await verifier.verify(accessToken: tampered, dpopJWK: jwk)
            XCTFail("tampered token should fail verification")
        } catch {}
        try await httpClient.shutdown()
    }

    private func request(path: String) -> Request {
        Request(
            head: HTTPRequest(
                method: .get,
                scheme: "https",
                authority: "api.testing.latr.link",
                path: path
            ),
            body: RequestBody(buffer: ByteBuffer())
        )
    }

    private func unsignedAccessToken() -> String {
        let header = #"{"alg":"none"}"#
        let payload = #"{"sub":"did:plc:test","iss":"https://auth.example","exp":4102444800,"cnf":{"jkt":"test"}}"#
        return "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8))).sig"
    }

    private func unsignedProof(htm: String, htu: String, accessToken: String) -> String {
        let header = #"{"typ":"dpop+jwt","alg":"none","jwk":{"kty":"EC","crv":"P-256","x":"test","y":"test"}}"#
        let ath = base64URLEncode(Data(SHA256.hash(data: Data(accessToken.utf8))))
        let payload = #"{"htm":"\#(htm)","htu":"\#(htu)","iat":1782860400,"jti":"unsigned-proof","ath":"\#(ath)"}"#
        return "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8))).sig"
    }

    private func signedAccessToken(signingKey: P256.Signing.PrivateKey, dpopJWK: DPoPJWK) throws -> String {
        let header = #"{"alg":"ES256","kid":"test-key"}"#
        let jkt = try jwkThumbprint(dpopJWK)
        let payload = #"{"sub":"did:plc:test","iss":"https://auth.example","exp":4102444800,"cnf":{"jkt":"\#(jkt)"}}"#
        return try signJWT(header: header, payload: payload, signingKey: signingKey)
    }

    private func signedDPoP(
        signingKey: P256.Signing.PrivateKey,
        jwk: DPoPJWK,
        htm: String,
        htu: String,
        accessToken: String
    ) throws -> String {
        let header = #"{"typ":"dpop+jwt","alg":"ES256","jwk":{"kty":"EC","crv":"P-256","x":"\#(jwk.x)","y":"\#(jwk.y)"}}"#
        let ath = base64URLEncode(Data(SHA256.hash(data: Data(accessToken.utf8))))
        let payload = #"{"htm":"\#(htm)","htu":"\#(htu)","iat":1782860400,"jti":"\#(UUID().uuidString)","ath":"\#(ath)"}"#
        return try signJWT(header: header, payload: payload, signingKey: signingKey)
    }

    private func signJWT(header: String, payload: String, signingKey: P256.Signing.PrivateKey) throws -> String {
        let signingInput = "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8)))"
        let signature = try signingKey.signature(for: Data(signingInput.utf8)).rawRepresentation
        return "\(signingInput).\(base64URLEncode(signature))"
    }

    private func jwk(for publicKey: P256.Signing.PublicKey) -> DPoPJWK {
        let raw = publicKey.x963Representation
        return DPoPJWK(
            kty: "EC",
            crv: "P-256",
            x: base64URLEncode(raw.dropFirst().prefix(32)),
            y: base64URLEncode(raw.dropFirst(33).prefix(32))
        )
    }
}
