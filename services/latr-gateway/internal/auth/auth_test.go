package auth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	secp "github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type resolver struct{ required bool }

func (s *resolver) ResolveClientID(_ context.Context, _ http.Header, required bool) (string, error) {
	s.required = required
	return "", nil
}
func publicJWK(key *ecdsa.PrivateKey, curve string) JWK {
	return JWK{Kty: "EC", Crv: curve, X: base64.RawURLEncoding.EncodeToString(key.X.FillBytes(make([]byte, 32))), Y: base64.RawURLEncoding.EncodeToString(key.Y.FillBytes(make([]byte, 32)))}
}
func signed(t *testing.T, key *ecdsa.PrivateKey, header, claims any) string {
	t.Helper()
	h, _ := json.Marshal(header)
	p, _ := json.Marshal(claims)
	input := base64.RawURLEncoding.EncodeToString(h) + "." + base64.RawURLEncoding.EncodeToString(p)
	hash := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, hash[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return input + "." + base64.RawURLEncoding.EncodeToString(sig)
}
func fixture(t *testing.T, alg string, emptyJWKS bool) (*Verifier, *http.Request, *ecdsa.PrivateKey, string) {
	t.Helper()
	proofKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	curve := elliptic.P256()
	crv := "P-256"
	if alg == "ES256K" {
		curve = secp.S256()
		crv = "secp256k1"
	}
	tokenKey, err := ecdsa.GenerateKey(curve, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwk := publicJWK(proofKey, "P-256")
	token := signed(t, tokenKey, map[string]any{"alg": alg, "kid": "issuer-key"}, map[string]any{"iss": "https://issuer.example", "sub": "did:plc:alice", "exp": int64(2000000100), "cnf": map[string]string{"jkt": Thumbprint(jwk)}})
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		var body any
		switch r.URL.Path {
		case "/.well-known/oauth-authorization-server":
			body = map[string]string{"issuer": "https://issuer.example", "jwks_uri": "https://issuer.example/keys"}
		case "/keys":
			keys := []JWK{}
			if !emptyJWKS {
				k := publicJWK(tokenKey, crv)
				k.Kid = "issuer-key"
				keys = append(keys, k)
			}
			body = map[string]any{"keys": keys}
		default:
			t.Fatalf("unexpected metadata URL %s", r.URL)
		}
		data, _ := json.Marshal(body)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data)), Header: http.Header{}}, nil
	})}
	v := New(config.Config{}, nil, client)
	v.Now = func() time.Time { return time.Unix(2000000000, 0) }
	req := httptest.NewRequest("GET", "https://gateway.example/xrpc/link.latr.auth.probe", nil)
	req.Header.Set("Authorization", "DPoP "+token)
	hash := sha256.Sum256([]byte(token))
	req.Header.Set("DPoP", signed(t, proofKey, map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": jwk}, map[string]any{"htm": "GET", "htu": req.URL.String(), "iat": v.Now().Unix(), "jti": "unique", "ath": base64.RawURLEncoding.EncodeToString(hash[:])}))
	return v, req, proofKey, token
}
func TestOAuthSignatureAndAuthorityModes(t *testing.T) {
	for _, test := range []struct {
		alg             string
		empty, verified bool
	}{{"ES256", false, true}, {"ES256K", false, true}, {"HS256", true, false}, {"ES256", true, false}} {
		t.Run(test.alg+map[bool]string{true: "-empty", false: "-public"}[test.empty], func(t *testing.T) {
			v, r, _, _ := fixture(t, test.alg, test.empty)
			result, err := v.Authenticate(r, true, "")
			if err != nil {
				t.Fatal(err)
			}
			if result.DID != "did:plc:alice" || result.AccessTokenSignatureVerified != test.verified {
				t.Fatalf("wrong trust mode: %+v", result)
			}
			if _, err = v.Authenticate(r, true, ""); err == nil || err.(*Error).Code != "invalid_dpop_replay" {
				t.Fatalf("replay accepted: %v", err)
			}
		})
	}
}
func TestHS256RejectsPublishedKeys(t *testing.T) {
	v, r, _, _ := fixture(t, "HS256", false)
	if _, err := v.Authenticate(r, true, ""); err == nil {
		t.Fatal("HS token with published keys accepted")
	}
}
func TestInvalidProofDoesNotConsumeReplayID(t *testing.T) {
	v, r, _, _ := fixture(t, "ES256", false)
	valid := r.Header.Get("DPoP")
	parts := strings.Split(valid, ".")
	parts[2] = base64.RawURLEncoding.EncodeToString(make([]byte, 64))
	r.Header.Set("DPoP", strings.Join(parts, "."))
	if _, err := v.Authenticate(r, true, ""); err == nil {
		t.Fatal("invalid signature accepted")
	}
	r.Header.Set("DPoP", valid)
	if _, err := v.Authenticate(r, true, ""); err != nil {
		t.Fatalf("invalid signature poisoned replay ID: %v", err)
	}
}
func TestGatewayProofBinding(t *testing.T) {
	for _, change := range []string{"method", "url", "ath", "expired", "thumbprint"} {
		t.Run(change, func(t *testing.T) {
			v, r, key, token := fixture(t, "ES256", false)
			hash := sha256.Sum256([]byte(token))
			claims := map[string]any{"htm": "GET", "htu": r.URL.String(), "iat": v.Now().Unix(), "jti": "binding", "ath": base64.RawURLEncoding.EncodeToString(hash[:])}
			switch change {
			case "method":
				claims["htm"] = "POST"
			case "url":
				claims["htu"] = "https://other.example/"
			case "ath":
				claims["ath"] = "bad"
			case "expired":
				claims["iat"] = v.Now().Unix() - 301
			case "thumbprint":
				other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				key = other
			}
			r.Header.Set("DPoP", signed(t, key, map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": publicJWK(key, "P-256")}, claims))
			if _, err := v.Authenticate(r, true, ""); err == nil {
				t.Fatal("invalid binding accepted")
			}
		})
	}
}
func TestProxyAndDeveloperPolicies(t *testing.T) {
	v, r, key, token := fixture(t, "ES256", false)
	store := &resolver{}
	v.Store = store
	v.Config.OAuthRequireKnownClient = true
	r.Header.Set("X-Forwarded-Host", "web.example")
	r.Header.Set("X-Forwarded-Proto", "https")
	hash := sha256.Sum256([]byte(token))
	r.Header.Set("DPoP", signed(t, key, map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": publicJWK(key, "P-256")}, map[string]any{"htm": "GET", "htu": "https://web.example/api/latr-gateway/xrpc/link.latr.auth.probe?ignored=yes", "iat": v.Now().Unix(), "jti": "proxy", "ath": base64.RawURLEncoding.EncodeToString(hash[:])}))
	r.Header.Set("X-Latr-Forwarded-Authorization", r.Header.Get("Authorization"))
	r.Header.Del("Authorization")
	if _, err := v.Authenticate(r, false, ""); err != nil {
		t.Fatal(err)
	}
	if store.required {
		t.Fatal("developer route inherited known client policy")
	}
}

func TestTokenExpiryIssuerAndAlgorithmAreRejected(t *testing.T) {
	for _, test := range []string{"expiry", "issuer", "algorithm"} {
		t.Run(test, func(t *testing.T) {
			v, r, key, _ := fixture(t, "ES256", true)
			alg := "ES256"
			issuer := "https://issuer.example"
			expiry := v.Now().Unix() + 100
			switch test {
			case "expiry":
				expiry = v.Now().Unix() - 1
			case "issuer":
				issuer = "http://issuer.example"
			case "algorithm":
				alg = "none"
			}
			token := signed(t, key, map[string]any{"alg": alg}, map[string]any{"iss": issuer, "sub": "did:plc:alice", "exp": expiry, "cnf": map[string]string{"jkt": Thumbprint(publicJWK(key, "P-256"))}})
			hash := sha256.Sum256([]byte(token))
			r.Header.Set("Authorization", "Bearer "+token)
			r.Header.Set("DPoP", signed(t, key, map[string]any{"typ": "dpop+jwt", "alg": "ES256", "jwk": publicJWK(key, "P-256")}, map[string]any{"htm": r.Method, "htu": r.URL.String(), "iat": v.Now().Unix(), "jti": test, "ath": base64.RawURLEncoding.EncodeToString(hash[:])}))
			if _, err := v.Authenticate(r, true, ""); err == nil {
				t.Fatal("invalid token accepted")
			}
		})
	}
}

func TestUpstreamPoolStructureRejected(t *testing.T) {
	v, r, _, _ := fixture(t, "ES256", false)
	if _, err := v.Authenticate(r, true, "not-a-jwt"); err == nil || err.(*Error).Code != "invalid_dpop" {
		t.Fatalf("malformed upstream proof accepted: %v", err)
	}
}
