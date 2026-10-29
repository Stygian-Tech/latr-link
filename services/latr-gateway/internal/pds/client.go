// Package pds provides authenticated repository transport and DID discovery.
package pds

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/latr"
)

type Auth struct {
	DID               string
	Authorization     string
	DPoPProof         string
	UpstreamDPoPProof string
	SignatureVerified bool
}
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string     { return e.Message }
func (e *Error) HTTPStatus() int   { return e.Status }
func (e *Error) ErrorCode() string { return e.Code }

type ProofPool struct {
	mu     sync.Mutex
	proofs []string
}

func NewProofPool(raw string) *ProofPool {
	p := &ProofPool{}
	for _, s := range strings.Split(raw, ",") {
		if s = strings.TrimSpace(s); s != "" {
			p.proofs = append(p.proofs, s)
		}
	}
	return p
}
func (p *ProofPool) Consume(method, httpMethod, base string) (string, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	expected := strings.TrimRight(base, "/") + "/xrpc/" + method
	for i, proof := range p.proofs {
		parts := strings.Split(proof, ".")
		if len(parts) != 3 {
			continue
		}
		b, e := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
		if e != nil {
			continue
		}
		var claims struct {
			HTU string `json:"htu"`
			HTM string `json:"htm"`
		}
		if json.Unmarshal(b, &claims) != nil {
			continue
		}
		if strings.SplitN(claims.HTU, "?", 2)[0] == expected && strings.EqualFold(claims.HTM, httpMethod) {
			p.proofs = append(p.proofs[:i], p.proofs[i+1:]...)
			return proof, expected
		}
	}
	return "", ""
}

type Client struct {
	Auth   Auth
	PLCURL string
	HTTP   *http.Client
	Pool   *ProofPool
	mu     sync.Mutex
	base   string
}

func NewClient(auth Auth, plcURL string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	copy := *httpClient
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{Auth: auth, PLCURL: plcURL, HTTP: &copy, Pool: NewProofPool(auth.UpstreamDPoPProof)}
}
func (c *Client) DID() string { return c.Auth.DID }
func DIDDocumentURL(did, plc string) (string, error) {
	switch {
	case strings.HasPrefix(did, "did:plc:"), strings.HasPrefix(did, "did:pr:"):
		return strings.TrimRight(plc, "/") + "/" + url.PathEscape(did), nil
	case strings.HasPrefix(did, "did:web:"):
		parts := strings.Split(strings.TrimPrefix(did, "did:web:"), ":")
		host, e := url.PathUnescape(parts[0])
		if e != nil || host == "" || strings.ContainsAny(host, "/@?#") {
			return "", fmt.Errorf("invalid did:web")
		}
		path := "/.well-known/did.json"
		if len(parts) > 1 {
			for _, p := range parts[1:] {
				if p == "" || p == "." || p == ".." {
					return "", fmt.Errorf("invalid did:web path")
				}
			}
			path = "/" + strings.Join(parts[1:], "/") + "/did.json"
		}
		return "https://" + host + path, nil
	}
	return "", fmt.Errorf("unsupported DID method")
}
func ServiceEndpoints(doc map[string]any, kind string) []string {
	out := []string{}
	services, _ := doc["service"].([]any)
	for _, raw := range services {
		s, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := s["id"].(string)
		typ, _ := s["type"].(string)
		match := false
		switch kind {
		case "pds":
			match = id == "#atproto_pds" || typ == "AtprotoPersonalDataServer"
		case "appview":
			match = strings.EqualFold(id, "#bsky_appview") || strings.EqualFold(id, "#atproto_appview") || strings.HasSuffix(typ, "AppView")
		case "identity":
			match = strings.EqualFold(id, "#atproto_identity") || typ == "AtprotoPersonalDataServer" && strings.Contains(strings.ToLower(id), "identity")
		}
		endpoint, _ := s["serviceEndpoint"].(string)
		endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
		if match && endpoint != "" {
			found := false
			for _, s := range out {
				if s == endpoint {
					found = true
				}
			}
			if !found {
				out = append(out, endpoint)
			}
		}
	}
	return out
}
func (c *Client) Resolve(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.base != "" {
		return c.base, nil
	}
	u, e := DIDDocumentURL(c.Auth.DID, c.PLCURL)
	if e != nil {
		return "", e
	}
	req, e := http.NewRequestWithContext(ctx, "GET", u, nil)
	if e != nil {
		return "", e
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return "", e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", &Error{502, "pds_resolve", "DID lookup failed"}
	}
	body, e := io.ReadAll(io.LimitReader(resp.Body, 1048577))
	if e != nil || len(body) > 1048576 {
		return "", fmt.Errorf("DID response exceeds limit")
	}
	var doc map[string]any
	if e = json.Unmarshal(body, &doc); e != nil {
		return "", e
	}
	endpoints := ServiceEndpoints(doc, "pds")
	if len(endpoints) == 0 {
		return "", &Error{502, "pds_resolve", "Could not resolve viewer PDS"}
	}
	parsed, e := url.Parse(endpoints[0])
	if e != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return "", &Error{502, "pds_resolve", "Invalid PDS service URL"}
	}
	c.base = endpoints[0]
	return c.base, nil
}
func (c *Client) call(ctx context.Context, method, verb string, query url.Values, body any, authenticated, requireProof bool) (map[string]any, error) {
	base, e := c.Resolve(ctx)
	if e != nil {
		return nil, e
	}
	requestURL := base + "/xrpc/" + method
	proof := ""
	if authenticated {
		if p, u := c.Pool.Consume(method, verb, base); p != "" {
			proof, requestURL = p, u
		} else {
			if requireProof || !c.Auth.SignatureVerified {
				return nil, &Error{401, "missing_upstream_dpop", "Missing valid upstream DPoP proof for PDS " + method}
			}
			proof = c.Auth.DPoPProof
		}
	}
	if len(query) > 0 {
		requestURL += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return nil, e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, verb, requestURL, reader)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", c.Auth.Authorization)
		if proof != "" {
			req.Header.Set("DPoP", proof)
		}
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, 2097153))
	if e != nil {
		return nil, e
	}
	if len(b) > 2097152 {
		return nil, &Error{502, "pds_error", "PDS response exceeds limit"}
	}
	out := map[string]any{}
	if len(b) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(b))
		decoder.UseNumber()
		if e = decoder.Decode(&out); e != nil {
			return nil, &Error{502, "pds_error", "Invalid PDS JSON response"}
		}
		if decoder.Decode(new(any)) != io.EOF {
			return nil, &Error{502, "pds_error", "Invalid PDS JSON response"}
		}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		code, _ := out["error"].(string)
		message, _ := out["message"].(string)
		if method == "com.atproto.repo.getRecord" && (resp.StatusCode == 404 || resp.StatusCode == 400 && (code == "RecordNotFound" || strings.Contains(strings.ToLower(message), "could not locate record"))) {
			return nil, nil
		}
		if (resp.StatusCode == 400 || resp.StatusCode == 409) && strings.Contains(strings.ToLower(code+" "+message), "swap") {
			return nil, latr.ErrConflict
		}
		status := 502
		errorCode := "pds_error"
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			status = resp.StatusCode
			errorCode = map[int]string{401: "pds_unauthorized", 403: "pds_forbidden"}[status]
		}
		return nil, &Error{status, errorCode, fmt.Sprintf("PDS %s failed (%d): %s", method, resp.StatusCode, code)}
	}
	return out, nil
}
func (c *Client) AttestOAuthSession(ctx context.Context) error {
	out, e := c.call(ctx, "com.atproto.server.getSession", "GET", nil, nil, true, true)
	if e != nil {
		return e
	}
	if out["did"] != c.Auth.DID {
		return &Error{401, "pds_session_did_mismatch", "PDS session DID did not match access-token subject"}
	}
	return nil
}
func (c *Client) List(ctx context.Context, col string, limit int, cursor string) (latr.Page, error) {
	q := url.Values{"repo": {c.DID()}, "collection": {col}, "limit": {fmt.Sprint(limit)}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	out, e := c.call(ctx, "com.atproto.repo.listRecords", "GET", q, nil, true, false)
	if e != nil {
		return latr.Page{}, e
	}
	p := latr.Page{Records: []latr.Record{}}
	p.Cursor, _ = out["cursor"].(string)
	records, _ := out["records"].([]any)
	for _, raw := range records {
		r, e := decodeRecord(raw, col)
		if e == nil {
			p.Records = append(p.Records, *r)
		}
	}
	return p, nil
}
func decodeRecord(raw any, collection string) (*latr.Record, error) {
	m, ok := raw.(map[string]any)
	if !ok {
		return nil, &Error{502, "pds_record_decode", "PDS record could not be decoded"}
	}
	uri, _ := m["uri"].(string)
	cid, _ := m["cid"].(string)
	v, ok := m["value"].(map[string]any)
	if uri == "" || cid == "" || !ok || !validRecordValue(v, collection) {
		return nil, &Error{502, "pds_record_decode", "PDS record could not be decoded"}
	}
	return &latr.Record{URI: uri, CID: cid, Value: v}, nil
}
func (c *Client) Get(ctx context.Context, col, key string, authenticated bool) (*latr.Record, error) {
	out, e := c.call(ctx, "com.atproto.repo.getRecord", "GET", url.Values{"repo": {c.DID()}, "collection": {col}, "rkey": {key}}, nil, authenticated || !c.Auth.SignatureVerified, false)
	if e != nil || out == nil {
		return nil, e
	}
	return decodeRecord(out, col)
}
func (c *Client) Apply(ctx context.Context, writes []latr.Write) error {
	if len(writes) == 0 {
		return nil
	}
	_, e := c.call(ctx, "com.atproto.repo.applyWrites", "POST", nil, map[string]any{"repo": c.DID(), "writes": writes}, true, false)
	return e
}

// Match the pinned Swift Codable field checks before migration can retire a
// legacy source. Unknown fields remain intact, including exact JSON numbers.
func validRecordValue(v map[string]any, collection string) bool {
	required := []string{"$type"}
	optionalStrings := []string{}
	optionalArrays := []string{}
	switch collection {
	case latr.Bookmark:
		required = append(required, "subject", "createdAt")
		optionalArrays = append(optionalArrays, "tags")
	case latr.Metadata:
		required = append(required, "bookmarkUri", "subject")
		optionalStrings = append(optionalStrings, "state", "note", "lastOpenedAt")
		optionalArrays = append(optionalArrays, "legacyItemUris")
	case latr.External, latr.LegacyExternal:
		required = append(required, "url", "normalizedUrl", "fingerprint", "createdAt")
		optionalStrings = append(optionalStrings, "title", "excerpt", "site", "image", "language", "publishedAt", "author")
	case latr.SavedItem, latr.LegacySavedItem:
		required = append(required, "subjectUri", "savedAt")
		optionalStrings = append(optionalStrings, "state", "note", "lastOpenedAt", "linkedWebUrl", "previewTitle", "previewExcerpt", "previewSite", "previewImage", "previewAuthor")
		optionalArrays = append(optionalArrays, "tags")
	default:
		return true
	}
	for _, key := range required {
		if _, ok := v[key].(string); !ok {
			return false
		}
	}
	for _, key := range optionalStrings {
		if value, ok := v[key]; ok && value != nil {
			if _, ok := value.(string); !ok {
				return false
			}
		}
	}
	for _, key := range optionalArrays {
		if value, ok := v[key]; ok && value != nil {
			switch array := value.(type) {
			case []string:
			case []any:
				for _, item := range array {
					if _, ok := item.(string); !ok {
						return false
					}
				}
			default:
				return false
			}
		}
	}
	if collection == latr.Metadata || collection == latr.SavedItem || collection == latr.LegacySavedItem {
		if value, ok := v["state"]; ok && value != nil && value != "unread" && value != "archived" {
			return false
		}
	}
	return true
}
