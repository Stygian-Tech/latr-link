import AsyncHTTPClient
import Crypto
import Foundation
import Hummingbird
import HTTPTypes
@testable import LatrGatewayLib
import NIOCore
import P256K
import XCTest

final class AuthVerificationTests: XCTestCase {
    func testAuthExtractorsAcceptForwardedProxyHeaders() throws {
        var headers = HTTPFields()
        headers[HTTPField.Name(forwardedAuthorizationHeader)!] = "DPoP forwarded-token"
        headers[HTTPField.Name(forwardedDPOPHeader)!] = "forwarded.dpop.jwt"
        headers[HTTPField.Name(upstreamDPOPHeader)!] = "upstream.dpop.jwt"

        XCTAssertEqual(
            extractAuthorizationHeader(from: headers),
            "DPoP forwarded-token"
        )
        XCTAssertEqual(extractDPOPHeader(from: headers), "forwarded.dpop.jwt")
        XCTAssertEqual(extractUpstreamDPOPHeader(from: headers), "upstream.dpop.jwt")
    }

    func testAuthExtractorsAcceptLowercaseForwardedProxyHeaders() throws {
        var headers = HTTPFields()
        headers[HTTPField.Name(forwardedAuthorizationHeader.lowercased())!] =
            "DPoP forwarded-token"
        headers[HTTPField.Name(forwardedDPOPHeader.lowercased())!] =
            "forwarded.dpop.jwt"
        headers[HTTPField.Name(upstreamDPOPHeader.lowercased())!] =
            "upstream.dpop.jwt"

        XCTAssertEqual(
            extractAuthorizationHeader(from: headers),
            "DPoP forwarded-token"
        )
        XCTAssertEqual(extractDPOPHeader(from: headers), "forwarded.dpop.jwt")
        XCTAssertEqual(extractUpstreamDPOPHeader(from: headers), "upstream.dpop.jwt")
    }

    func testAuthExtractorsPreferStandardHeadersOverForwardedProxyHeaders() throws {
        var headers = HTTPFields()
        headers[.authorization] = "DPoP standard-token"
        headers[HTTPField.Name(forwardedAuthorizationHeader)!] = "DPoP forwarded-token"
        headers[HTTPField.Name("DPoP")!] = "standard.dpop.jwt"
        headers[HTTPField.Name(forwardedDPOPHeader)!] = "forwarded.dpop.jwt"

        XCTAssertEqual(extractAuthorizationHeader(from: headers), "DPoP standard-token")
        XCTAssertEqual(extractDPOPHeader(from: headers), "standard.dpop.jwt")
    }

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

    func testDPoPAcceptsForwardedProxyPrefixForSameGatewayRoute() throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let proof = try signedDPoP(
            signingKey: key,
            jwk: jwk,
            htm: "GET",
            htu: "https://testing.latr.link/api/latr-gateway/v1/latr/saves",
            accessToken: token
        )

        XCTAssertNoThrow(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(
                    path: "/v1/latr/saves",
                    headers: [
                        HTTPField.Name("X-Forwarded-Host")!: "testing.latr.link",
                        HTTPField.Name("X-Forwarded-Proto")!: "https",
                    ]
                )
            )
        )
    }

    func testDPoPAcceptsHostedAuthorityWhenSchemeIsMissing() throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let proof = try signedDPoP(
            signingKey: key,
            jwk: jwk,
            htm: "GET",
            htu: "https://api.testing.latr.link/v1/latr/saves",
            accessToken: token
        )

        XCTAssertNoThrow(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(
                    path: "/v1/latr/saves",
                    scheme: nil,
                    authority: "api.testing.latr.link"
                )
            )
        )
    }

    func testDPoPAcceptsForwardedProtoWithRequestAuthority() throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let proof = try signedDPoP(
            signingKey: key,
            jwk: jwk,
            htm: "GET",
            htu: "https://api.testing.latr.link/v1/latr/saves",
            accessToken: token
        )

        XCTAssertNoThrow(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(
                    path: "/v1/latr/saves",
                    scheme: "http",
                    authority: "api.testing.latr.link",
                    headers: [HTTPField.Name("X-Forwarded-Proto")!: "https"]
                )
            )
        )
    }

    func testDPoPAcceptsProofURLWithoutQueryString() throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let token = try signedAccessToken(signingKey: key, dpopJWK: jwk)
        let proof = try signedDPoP(
            signingKey: key,
            jwk: jwk,
            htm: "GET",
            htu: "https://api.testing.latr.link/v1/latr/og-preview",
            accessToken: token
        )

        XCTAssertNoThrow(
            try verifyGatewayDPoP(
                proof: proof,
                accessToken: token,
                request: request(
                    path: "/v1/latr/og-preview?url=https%3A%2F%2Fexample.com",
                    scheme: nil,
                    authority: "api.testing.latr.link"
                )
            )
        )
    }

    func testOAuthVerifierAcceptsES256AccessTokens() async throws {
        let signingKey = P256.Signing.PrivateKey()
        let signingJWK = jwk(for: signingKey.publicKey)
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try signedAccessToken(signingKey: signingKey, dpopJWK: dpopJWK)
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    let jwks = #"{"keys":[{"kty":"EC","kid":"test-key","alg":"ES256","crv":"P-256","x":"\#(signingJWK.x)","y":"\#(signingJWK.y)"}]}"#
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        let verified = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)

        XCTAssertEqual(verified.payload.sub, "did:plc:test")
        XCTAssertTrue(verified.signatureVerified)
        try await httpClient.shutdown()
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

    func testOAuthVerifierAcceptsES256KAccessTokens() async throws {
        let signingKey = try P256K.Signing.PrivateKey(
            dataRepresentation: Data(hex: "5f6d5afecc677d66fb3d41eee7a8ad8195659ceff588edaf416a9a17daf38fdd"),
            format: .uncompressed
        )
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try signedES256KAccessToken(signingKey: signingKey, dpopJWK: dpopJWK)
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    let jwk = es256kJWK(for: signingKey.publicKey)
                    let jwks = #"{"keys":[{"kty":"EC","kid":"test-key","alg":"ES256K","crv":"secp256k1","x":"\#(jwk.x)","y":"\#(jwk.y)"}]}"#
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        let verified = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)

        XCTAssertEqual(verified.payload.sub, "did:plc:test")
        XCTAssertTrue(verified.signatureVerified)
        try await httpClient.shutdown()
    }

    func testOAuthVerifierAcceptsDPoPBoundTokenWhenIssuerJWKSIsEmpty() async throws {
        let signingKey = try P256K.Signing.PrivateKey(
            dataRepresentation: Data(hex: "5f6d5afecc677d66fb3d41eee7a8ad8195659ceff588edaf416a9a17daf38fdd"),
            format: .uncompressed
        )
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try signedES256KAccessToken(signingKey: signingKey, dpopJWK: dpopJWK)
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    return Data(#"{"keys":[]}"#.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        let verified = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)

        XCTAssertEqual(verified.payload.sub, "did:plc:test")
        XCTAssertFalse(verified.signatureVerified)
        try await httpClient.shutdown()
    }

    func testOAuthVerifierAcceptsHS256AsPDSAuthorityTokenWhenIssuerJWKSIsEmpty() async throws {
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try syntheticAccessToken(
            alg: "HS256",
            dpopThumbprint: jwkThumbprint(dpopJWK)
        )
        let (verifier, httpClient) = oauthVerifier(jwks: #"{"keys":[]}"#)

        let verified = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)

        XCTAssertEqual(verified.payload.sub, "did:plc:test")
        XCTAssertFalse(verified.signatureVerified)
        try await httpClient.shutdown()
    }

    func testOAuthVerifierRejectsHS256WithoutDPoPConfirmation() async throws {
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try syntheticAccessToken(alg: "HS256", dpopThumbprint: nil)
        let (verifier, httpClient) = oauthVerifier(jwks: #"{"keys":[]}"#)

        do {
            _ = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)
            XCTFail("HS256 token without cnf.jkt should fail verification")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "invalid_token")
            XCTAssertEqual(error.message, "Token missing DPoP confirmation")
        }
        try await httpClient.shutdown()
    }

    func testOAuthVerifierRejectsHS256WithMismatchedDPoPConfirmation() async throws {
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try syntheticAccessToken(alg: "HS256", dpopThumbprint: "wrong-thumbprint")
        let (verifier, httpClient) = oauthVerifier(jwks: #"{"keys":[]}"#)

        do {
            _ = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)
            XCTFail("HS256 token with mismatched cnf.jkt should fail verification")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "invalid_token")
            XCTAssertEqual(error.message, "Token DPoP key mismatch")
        }
        try await httpClient.shutdown()
    }

    func testOAuthVerifierRejectsHS256WhenIssuerJWKSIsNotEmpty() async throws {
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try syntheticAccessToken(
            alg: "HS256",
            dpopThumbprint: jwkThumbprint(dpopJWK)
        )
        let jwks = #"{"keys":[{"kty":"EC","kid":"public-key","alg":"ES256","crv":"P-256"}]}"#
        let (verifier, httpClient) = oauthVerifier(jwks: jwks)

        do {
            _ = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)
            XCTFail("HS256 token should not bypass a populated JWKS")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "invalid_token")
            XCTAssertEqual(error.message, "Token signing key not found")
        }
        try await httpClient.shutdown()
    }

    func testOAuthVerifierRejectsTamperedES256KAccessTokens() async throws {
        let signingKey = try P256K.Signing.PrivateKey(
            dataRepresentation: Data(hex: "5f6d5afecc677d66fb3d41eee7a8ad8195659ceff588edaf416a9a17daf38fdd"),
            format: .uncompressed
        )
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try signedES256KAccessToken(signingKey: signingKey, dpopJWK: dpopJWK)
        let tampered = "\(token)a"
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    let jwk = es256kJWK(for: signingKey.publicKey)
                    let jwks = #"{"keys":[{"kty":"EC","kid":"test-key","alg":"ES256K","crv":"secp256k1","x":"\#(jwk.x)","y":"\#(jwk.y)"}]}"#
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        do {
            _ = try await verifier.verify(accessToken: tampered, dpopJWK: dpopJWK)
            XCTFail("tampered ES256K token should fail verification")
        } catch let error as GatewayError {
            XCTAssertEqual(error.code, "invalid_token")
        }
        try await httpClient.shutdown()
    }

    func testOAuthVerifierRejectsES256KTokenWithoutDPoPConfirmation() async throws {
        let signingKey = try P256K.Signing.PrivateKey(
            dataRepresentation: Data(hex: "5f6d5afecc677d66fb3d41eee7a8ad8195659ceff588edaf416a9a17daf38fdd"),
            format: .uncompressed
        )
        let dpopKey = P256.Signing.PrivateKey()
        let dpopJWK = jwk(for: dpopKey.publicKey)
        let token = try signedES256KAccessTokenWithoutDPoPConfirmation(signingKey: signingKey)
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    let jwk = es256kJWK(for: signingKey.publicKey)
                    let jwks = #"{"keys":[{"kty":"EC","kid":"test-key","alg":"ES256K","crv":"secp256k1","x":"\#(jwk.x)","y":"\#(jwk.y)"}]}"#
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        do {
            _ = try await verifier.verify(accessToken: token, dpopJWK: dpopJWK)
            XCTFail("ES256K token without cnf.jkt should fail verification")
        } catch let error as GatewayError {
            XCTAssertEqual(error.message, "Token missing DPoP confirmation")
        }
        try await httpClient.shutdown()
    }

    func testOAuthVerifierReportsUnsupportedAccessTokenAlgorithms() async throws {
        let key = P256.Signing.PrivateKey()
        let jwk = jwk(for: key.publicKey)
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    return Data(#"{"keys":[]}"#.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )

        for algorithm in ["none", "EdDSA", "RS256"] {
            let token = try unsupportedAccessToken(alg: algorithm, dpopJWK: jwk)
            do {
                _ = try await verifier.verify(accessToken: token, dpopJWK: jwk)
                XCTFail("\(algorithm) token algorithm should fail verification")
            } catch let error as GatewayError {
                XCTAssertEqual(error.code, "unsupported_token_alg")
            }
        }
        try await httpClient.shutdown()
    }

    private func request(
        path: String,
        scheme: String? = "https",
        authority: String? = "api.testing.latr.link",
        headers: HTTPFields = [:]
    ) -> Request {
        Request(
            head: HTTPRequest(
                method: .get,
                scheme: scheme,
                authority: authority,
                path: path,
                headerFields: headers
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

    private func signedES256KAccessToken(signingKey: P256K.Signing.PrivateKey, dpopJWK: DPoPJWK) throws -> String {
        let header = #"{"typ":"at+jwt","alg":"ES256K","kid":"test-key"}"#
        let jkt = try jwkThumbprint(dpopJWK)
        let payload = #"{"sub":"did:plc:test","iss":"https://auth.example","exp":4102444800,"cnf":{"jkt":"\#(jkt)"}}"#
        return try signJWT(header: header, payload: payload, signingKey: signingKey)
    }

    private func signedES256KAccessTokenWithoutDPoPConfirmation(signingKey: P256K.Signing.PrivateKey) throws -> String {
        let header = #"{"typ":"at+jwt","alg":"ES256K","kid":"test-key"}"#
        let payload = #"{"sub":"did:plc:test","iss":"https://auth.example","exp":4102444800}"#
        return try signJWT(header: header, payload: payload, signingKey: signingKey)
    }

    private func unsupportedAccessToken(alg: String, dpopJWK: DPoPJWK) throws -> String {
        let header = #"{"typ":"at+jwt","alg":"\#(alg)","kid":"test-key"}"#
        let jkt = try jwkThumbprint(dpopJWK)
        let payload = #"{"sub":"did:plc:test","iss":"https://auth.example","exp":4102444800,"cnf":{"jkt":"\#(jkt)"}}"#
        return "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8))).sig"
    }

    private func syntheticAccessToken(alg: String, dpopThumbprint: String?) throws -> String {
        let header = try JSONSerialization.data(withJSONObject: [
            "alg": alg,
            "kid": "test-key",
            "typ": "at+jwt",
        ])
        var payload: [String: Any] = [
            "sub": "did:plc:test",
            "iss": "https://auth.example",
            "exp": 4_102_444_800,
        ]
        if let dpopThumbprint {
            payload["cnf"] = ["jkt": dpopThumbprint]
        }
        let payloadData = try JSONSerialization.data(withJSONObject: payload)
        return "\(base64URLEncode(header)).\(base64URLEncode(payloadData)).signature"
    }

    private func oauthVerifier(jwks: String) -> (OAuthTokenVerifier, HTTPClient) {
        let httpClient = HTTPClient(eventLoopGroupProvider: .singleton)
        let verifier = OAuthTokenVerifier(
            httpClient: httpClient,
            fetchData: { url in
                if url.absoluteString == "https://auth.example/.well-known/oauth-authorization-server" {
                    return Data(#"{"issuer":"https://auth.example","jwks_uri":"https://auth.example/jwks.json"}"#.utf8)
                }
                if url.absoluteString == "https://auth.example/jwks.json" {
                    return Data(jwks.utf8)
                }
                throw GatewayError(status: .unauthorized, message: "unexpected url", code: "test")
            }
        )
        return (verifier, httpClient)
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
        let iat = Int(Date().timeIntervalSince1970)
        let payload = #"{"htm":"\#(htm)","htu":"\#(htu)","iat":\#(iat),"jti":"\#(UUID().uuidString)","ath":"\#(ath)"}"#
        return try signJWT(header: header, payload: payload, signingKey: signingKey)
    }

    private func signJWT(header: String, payload: String, signingKey: P256.Signing.PrivateKey) throws -> String {
        let signingInput = "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8)))"
        let signature = try signingKey.signature(for: Data(signingInput.utf8)).rawRepresentation
        return "\(signingInput).\(base64URLEncode(signature))"
    }

    private func signJWT(header: String, payload: String, signingKey: P256K.Signing.PrivateKey) throws -> String {
        let signingInput = "\(base64URLEncode(Data(header.utf8))).\(base64URLEncode(Data(payload.utf8)))"
        let signature = signingKey.signature(for: Data(signingInput.utf8)).compactRepresentation
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

private func es256kJWK(for publicKey: P256K.Signing.PublicKey) -> (x: String, y: String) {
    let raw = publicKey.uncompressedRepresentation
    return (
        x: base64URLEncode(raw.dropFirst().prefix(32)),
        y: base64URLEncode(raw.dropFirst(33).prefix(32))
    )
}

private extension Data {
    init(hex: String) {
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let nextIndex = hex.index(index, offsetBy: 2)
            bytes.append(UInt8(hex[index..<nextIndex], radix: 16)!)
            index = nextIndex
        }
        self.init(bytes)
    }
}
