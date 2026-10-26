// Package auth verifies gateway-bound proofs and OAuth tokens. Tokens whose
// issuer publishes no signing key remain untrusted until the PDS attests them.
package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	secp "github.com/decred/dcrd/dcrec/secp256k1/v4"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string           { return e.Message }
func (e *Error) HTTPStatus() int         { return e.Status }
func (e *Error) ErrorCode() string       { return e.Code }
func failure(code, message string) error { return &Error{401, code, message} }

type Context struct {
	DID, AuthorizationHeader, DPoPProof, UpstreamDPoPProof, ClientID string
	AccessTokenSignatureVerified                                     bool
}
type ClientResolver interface {
	ResolveClientID(context.Context, http.Header, bool) (string, error)
}
type Verifier struct {
	Config config.Config
	Store  ClientResolver
	Client *http.Client
	Now    func() time.Time
	mu     sync.Mutex
	seen   map[string]int64
}

func New(cfg config.Config, store ClientResolver, client *http.Client) *Verifier {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Verifier{Config: cfg, Store: store, Client: client, Now: time.Now, seen: map[string]int64{}}
}

func (v *Verifier) Authenticate(r *http.Request, requireApplicationCredential bool, upstreamOverride string) (Context, error) {
	var result Context
	require := requireApplicationCredential && (v.Config.RequireClientAPIKey || v.Config.OAuthRequireKnownClient)
	if v.Store != nil {
		id, err := v.Store.ResolveClientID(r.Context(), r.Header, require)
		if err != nil {
			return result, err
		}
		result.ClientID = id
	} else if require {
		return result, &Error{403, "missing_client_credential", "Missing gateway client credentials"}
	}
	result.AuthorizationHeader = header(r.Header, "Authorization", "X-Latr-Forwarded-Authorization")
	if result.AuthorizationHeader == "" {
		return result, failure("missing_auth", "Missing Authorization header")
	}
	token := AccessToken(result.AuthorizationHeader)
	if token == "" {
		return result, failure("invalid_auth_scheme", "Authorization header must prefix DPoP or Bearer")
	}
	result.DPoPProof = header(r.Header, "DPoP", "X-Latr-Forwarded-DPoP")
	if result.DPoPProof == "" {
		return result, failure("missing_dpop", "Missing DPoP proof header")
	}
	jwk, err := v.verifyDPoP(r, result.DPoPProof, token)
	if err != nil {
		return result, err
	}
	claims, verified, err := v.verifyToken(r.Context(), token, jwk)
	if err != nil {
		return result, err
	}
	result.DID = strings.TrimSpace(claims.Sub)
	if !strings.HasPrefix(result.DID, "did:") {
		return result, failure("invalid_sub", "Access token sub must be a DID")
	}
	if claims.Exp != nil && *claims.Exp < v.Now().Unix() {
		return result, failure("token_expired", "Access token expired")
	}
	result.AccessTokenSignatureVerified = verified
	result.UpstreamDPoPProof = header(r.Header, "X-ATProto-Upstream-DPoP")
	if upstreamOverride != "" {
		result.UpstreamDPoPProof = strings.TrimSpace(upstreamOverride)
	}
	for _, proof := range strings.Split(result.UpstreamDPoPProof, ",") {
		if proof = strings.TrimSpace(proof); proof != "" && len(strings.Split(proof, ".")) != 3 {
			return result, failure("invalid_dpop", "Invalid DPoP proof structure")
		}
	}
	return result, nil
}
func AccessToken(authorization string) string {
	parts := strings.SplitN(strings.TrimSpace(authorization), " ", 2)
	if len(parts) != 2 || (!strings.EqualFold(parts[0], "DPoP") && !strings.EqualFold(parts[0], "Bearer")) {
		return ""
	}
	return strings.TrimSpace(parts[1])
}
func header(h http.Header, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(h.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Kid string `json:"kid,omitempty"`
	Alg string `json:"alg,omitempty"`
}
type tokenHeader struct {
	Typ string `json:"typ"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	JWK JWK    `json:"jwk"`
}
type tokenClaims struct {
	Iss string `json:"iss"`
	Sub string `json:"sub"`
	Exp *int64 `json:"exp"`
	CNF struct {
		JKT string `json:"jkt"`
	} `json:"cnf"`
}
type proofClaims struct {
	HTM string `json:"htm"`
	HTU string `json:"htu"`
	IAT *int64 `json:"iat"`
	JTI string `json:"jti"`
	ATH string `json:"ath"`
}

func decodeJWT(token string, h, p any) ([]byte, []byte, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, fmt.Errorf("malformed JWT")
	}
	for i, target := range []any{h, p} {
		data, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[i], "="))
		if err != nil {
			return nil, nil, err
		}
		if err = json.Unmarshal(data, target); err != nil {
			return nil, nil, err
		}
	}
	sig, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[2], "="))
	return []byte(parts[0] + "." + parts[1]), sig, err
}
func Thumbprint(key JWK) string {
	canonical := struct {
		Crv string `json:"crv"`
		Kty string `json:"kty"`
		X   string `json:"x"`
		Y   string `json:"y"`
	}{key.Crv, key.Kty, key.X, key.Y}
	data, _ := json.Marshal(canonical)
	hash := sha256.Sum256(data)
	return base64.RawURLEncoding.EncodeToString(hash[:])
}
func verifySignature(key JWK, alg string, input, signature []byte) bool {
	if key.Kty != "EC" || len(signature) != 64 {
		return false
	}
	var curve elliptic.Curve
	switch {
	case alg == "ES256" && key.Crv == "P-256":
		curve = elliptic.P256()
	case alg == "ES256K" && key.Crv == "secp256k1":
		curve = secp.S256()
	default:
		return false
	}
	x, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(key.X, "="))
	if err != nil || len(x) != 32 {
		return false
	}
	y, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(key.Y, "="))
	if err != nil || len(y) != 32 {
		return false
	}
	pub := ecdsa.PublicKey{Curve: curve, X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
	if !curve.IsOnCurve(pub.X, pub.Y) {
		return false
	}
	hash := sha256.Sum256(input)
	return ecdsa.Verify(&pub, hash[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:]))
}
func (v *Verifier) verifyDPoP(r *http.Request, proof, token string) (JWK, error) {
	var h tokenHeader
	var p proofClaims
	input, sig, err := decodeJWT(proof, &h, &p)
	if err != nil {
		return JWK{}, failure("invalid_dpop", "Malformed DPoP proof")
	}
	bad := func(message string) (JWK, error) { return JWK{}, failure("invalid_dpop", message) }
	if !strings.EqualFold(h.Typ, "dpop+jwt") {
		return bad("Invalid DPoP proof type")
	}
	if h.Alg != "ES256" || h.JWK.Kty != "EC" || h.JWK.Crv != "P-256" {
		return bad("Unsupported DPoP key")
	}
	if !strings.EqualFold(p.HTM, r.Method) {
		return bad("DPoP method mismatch")
	}
	match := false
	normalized := normalizeURL(p.HTU)
	for _, candidate := range RequestURLCandidates(r) {
		if normalized != "" && normalized == normalizeURL(candidate) {
			match = true
		}
	}
	if !match {
		return bad("DPoP URL mismatch")
	}
	now := v.Now().Unix()
	if p.IAT == nil || *p.IAT < now-300 || *p.IAT > now+300 {
		return bad("DPoP proof expired")
	}
	if strings.TrimSpace(p.JTI) == "" {
		return JWK{}, failure("invalid_dpop_replay", "DPoP proof replayed")
	}
	hash := sha256.Sum256([]byte(token))
	if p.ATH != base64.RawURLEncoding.EncodeToString(hash[:]) {
		return bad("DPoP access token hash mismatch")
	}
	if !verifySignature(h.JWK, h.Alg, input, sig) {
		return bad("Invalid DPoP signature")
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	for jti, expires := range v.seen {
		if expires < now {
			delete(v.seen, jti)
		}
	}
	if _, ok := v.seen[p.JTI]; ok {
		return JWK{}, failure("invalid_dpop_replay", "DPoP proof replayed")
	}
	v.seen[p.JTI] = *p.IAT + 300
	return h.JWK, nil
}
func normalizeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.RawQuery = ""
	u.Fragment = ""
	u.ForceQuery = false
	if (u.Scheme == "https" && u.Port() == "443") || (u.Scheme == "http" && u.Port() == "80") {
		u.Host = u.Hostname()
		if strings.Contains(u.Host, ":") {
			u.Host = "[" + u.Host + "]"
		}
	}
	return u.String()
}
func RequestURLCandidates(r *http.Request) []string {
	scheme := r.URL.Scheme
	if scheme == "" {
		scheme = "https"
		if r.TLS == nil && (r.Host == "localhost" || strings.HasPrefix(r.Host, "localhost:") || strings.HasPrefix(r.Host, "127.0.0.1") || strings.HasPrefix(r.Host, "[::1]")) {
			scheme = "http"
		}
	}
	authority := r.Host
	if r.URL.Host != "" {
		authority = r.URL.Host
	}
	path := r.URL.RequestURI()
	out := []string{scheme + "://" + authority + path}
	first := func(name string) string { return strings.TrimSpace(strings.Split(r.Header.Get(name), ",")[0]) }
	host, proto := first("X-Forwarded-Host"), first("X-Forwarded-Proto")
	if host != "" || proto != "" {
		if host == "" {
			host = authority
		}
		if proto == "" {
			proto = scheme
		}
		out = append(out, proto+"://"+host+path, proto+"://"+host+"/api/latr-gateway"+path)
	}
	for _, name := range []string{"X-Original-URL", "X-Original-URI", "X-Forwarded-URI", "X-Rewrite-URL"} {
		if original := first(name); original != "" {
			if !strings.HasPrefix(original, "http://") && !strings.HasPrefix(original, "https://") {
				if host == "" {
					host = authority
				}
				if proto == "" {
					proto = scheme
				}
				original = proto + "://" + host + "/" + strings.TrimPrefix(original, "/")
			}
			out = append(out, original)
			break
		}
	}
	return out
}
func (v *Verifier) fetchJSON(ctx context.Context, raw string, target any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return failure("invalid_token", "Invalid token metadata URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return failure("invalid_token", "Token metadata lookup failed")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := v.Client.Do(req)
	if err != nil {
		return failure("invalid_token", "Token metadata lookup failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return failure("invalid_token", "Token metadata lookup failed")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1048577))
	if err != nil || len(data) > 1048576 {
		return failure("invalid_token", "Token metadata lookup failed")
	}
	if json.Unmarshal(data, target) != nil {
		return failure("invalid_token", "Invalid token metadata")
	}
	return nil
}
func (v *Verifier) verifyToken(ctx context.Context, token string, key JWK) (tokenClaims, bool, error) {
	var h tokenHeader
	var p tokenClaims
	input, sig, err := decodeJWT(token, &h, &p)
	if err != nil {
		return p, false, failure("invalid_token", "Malformed access token")
	}
	issuer, err := url.Parse(p.Iss)
	if err != nil || issuer.Scheme != "https" || issuer.Hostname() == "" {
		return p, false, failure("invalid_token", "Missing token issuer")
	}
	var metadata struct {
		Issuer  string `json:"issuer"`
		JWKSURI string `json:"jwks_uri"`
	}
	metadataURL := *issuer
	metadataURL.Path = strings.TrimRight(metadataURL.Path, "/") + "/.well-known/oauth-authorization-server"
	if err = v.fetchJSON(ctx, metadataURL.String(), &metadata); err != nil {
		return p, false, err
	}
	if metadata.Issuer != "" && metadata.Issuer != p.Iss {
		return p, false, failure("invalid_token", "Token issuer metadata mismatch")
	}
	if h.Alg != "ES256" && h.Alg != "ES256K" && h.Alg != "HS256" {
		return p, false, failure("unsupported_token_alg", "Unsupported token signing algorithm: "+h.Alg)
	}
	var keys struct {
		Keys []JWK `json:"keys"`
	}
	if err = v.fetchJSON(ctx, metadata.JWKSURI, &keys); err != nil {
		return p, false, err
	}
	if p.CNF.JKT == "" {
		return p, false, failure("invalid_token", "Token missing DPoP confirmation")
	}
	if p.CNF.JKT != Thumbprint(key) {
		return p, false, failure("invalid_token", "Token DPoP key mismatch")
	}
	if len(keys.Keys) == 0 {
		return p, false, nil
	}
	if h.Alg == "HS256" {
		return p, false, failure("invalid_token", "Token signing key not found")
	}
	for _, candidate := range keys.Keys {
		curve := "P-256"
		if h.Alg == "ES256K" {
			curve = "secp256k1"
		}
		if candidate.Kty != "EC" || candidate.Crv != curve || (candidate.Alg != "" && candidate.Alg != h.Alg) || (h.Kid != "" && candidate.Kid != h.Kid) {
			continue
		}
		if !verifySignature(candidate, h.Alg, input, sig) {
			return p, false, failure("invalid_token", "Invalid token signature")
		}
		return p, true, nil
	}
	return p, false, failure("invalid_token", "Token signing key not found")
}
