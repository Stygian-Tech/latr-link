// Package latr implements the portable L@tr repository contracts.
package latr

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/rivo/uniseg"
)

const (
	Bookmark        = "community.lexicon.bookmarks.bookmark"
	Metadata        = "link.latr.bookmarks.metadata"
	External        = "link.latr.saved.external"
	SavedItem       = "link.latr.saved.item"
	LegacyExternal  = "com.latr.saved.external"
	LegacySavedItem = "com.latr.saved.item"
)

var (
	ErrConflict      = errors.New("repository changed; retry the operation")
	ErrNotFound      = errors.New("bookmark not found")
	ErrInvalidURL    = errors.New("invalid URL")
	ErrInvalidRecord = errors.New("invalid stored record")
)

type InvalidRequestError struct{ Message string }

func (e *InvalidRequestError) Error() string     { return e.Message }
func (e *InvalidRequestError) HTTPStatus() int   { return 400 }
func (e *InvalidRequestError) ErrorCode() string { return "invalid_request" }
func invalidRequest(message string) error        { return &InvalidRequestError{Message: message} }

type Record struct {
	URI   string         `json:"uri"`
	CID   string         `json:"cid"`
	Value map[string]any `json:"value"`
}
type Page struct {
	Records []Record `json:"records"`
	Cursor  string   `json:"cursor,omitempty"`
}
type Write struct {
	Type       string         `json:"$type"`
	Collection string         `json:"collection"`
	Key        string         `json:"rkey"`
	Value      map[string]any `json:"value,omitempty"`
	SwapRecord string         `json:"swapRecord,omitempty"`
}

func Create(collection, key string, value map[string]any) Write {
	return Write{Type: "com.atproto.repo.applyWrites#create", Collection: collection, Key: key, Value: value}
}
func Update(collection, key string, value map[string]any, cid string) Write {
	return Write{Type: "com.atproto.repo.applyWrites#update", Collection: collection, Key: key, Value: value, SwapRecord: cid}
}
func Delete(collection, key, cid string) Write {
	return Write{Type: "com.atproto.repo.applyWrites#delete", Collection: collection, Key: key, SwapRecord: cid}
}

type Repository interface {
	DID() string
	List(context.Context, string, int, string) (Page, error)
	Get(context.Context, string, string, bool) (*Record, error)
	Apply(context.Context, []Write) error
}
type View struct {
	URI            string         `json:"uri"`
	CID            string         `json:"cid"`
	Value          map[string]any `json:"value"`
	MetadataRecord *Record        `json:"metadataRecord,omitempty"`
	Preview        map[string]any `json:"preview,omitempty"`
}
type BookmarkPage struct {
	Records []View `json:"records"`
	Cursor  string `json:"cursor,omitempty"`
}
type Library struct{ Repo Repository }

func RecordKey(text string) string {
	hash := sha256.Sum256([]byte(text))
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(hash[:])
}
func Fingerprint(text string) string {
	hash := sha256.Sum256([]byte(text))
	return hex.EncodeToString(hash[:])
}
func NewTID() string {
	var entropy [2]byte
	_, _ = rand.Read(entropy[:])
	v := uint64(time.Now().UnixMicro())<<10 | uint64(entropy[0])<<2 | uint64(entropy[1]&3)
	const alphabet = "234567abcdefghijklmnopqrstuvwxyz"
	out := make([]byte, 13)
	for i := 12; i >= 0; i-- {
		out[i] = alphabet[v&31]
		v >>= 5
	}
	return string(out)
}

// NormalizeURL matches LatrKit URLComponents normalization, including literal
// plus signs and valueless query items (net/url.Values would change both).
func NormalizeURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (strings.ToLower(u.Scheme) != "https" && strings.ToLower(u.Scheme) != "http") {
		return "", ErrInvalidURL
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	u.RawFragment = ""
	if u.Path != "/" && strings.HasSuffix(u.Path, "/") {
		u.Path = strings.TrimRight(u.Path, "/")
		u.RawPath = ""
	}
	type item struct {
		name, value string
		hasValue    bool
	}
	items := []item{}
	if u.RawQuery != "" {
		for _, part := range strings.Split(u.RawQuery, "&") {
			pair := strings.SplitN(part, "=", 2)
			name, e := url.PathUnescape(pair[0])
			if e != nil {
				return "", ErrInvalidURL
			}
			lower := strings.ToLower(name)
			if strings.HasPrefix(lower, "utm_") || lower == "fbclid" || lower == "gclid" || lower == "ref" {
				continue
			}
			v := item{name: name, hasValue: len(pair) == 2}
			if v.hasValue {
				v.value, e = url.PathUnescape(pair[1])
				if e != nil {
					return "", ErrInvalidURL
				}
			}
			items = append(items, v)
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].name == items[j].name {
			return items[i].value < items[j].value
		}
		return items[i].name < items[j].name
	})
	encoded := []string{}
	for _, v := range items {
		s := queryEscape(v.name)
		if v.hasValue {
			s += "=" + queryEscape(v.value)
		}
		encoded = append(encoded, s)
	}
	u.RawQuery = strings.Join(encoded, "&")
	u.ForceQuery = false
	return u.String(), nil
}
func queryEscape(s string) string {
	const hex = "0123456789ABCDEF"
	var out strings.Builder
	for _, b := range []byte(s) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("-._~!$'()*+,/:;?@", rune(b)) {
			out.WriteByte(b)
		} else {
			out.WriteByte('%')
			out.WriteByte(hex[b>>4])
			out.WriteByte(hex[b&15])
		}
	}
	return out.String()
}

func NormalizeTag(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", invalidRequest("Tags must not be empty")
	}
	if uniseg.GraphemeClusterCount(v) > 64 {
		return "", invalidRequest("Each tag may have at most 64 characters")
	}
	if len(v) > 640 {
		return "", invalidRequest("Each tag may use at most 640 UTF-8 bytes")
	}
	return v, nil
}
func NormalizeTags(raw []string) ([]string, error) {
	if len(raw) > 100 {
		return nil, invalidRequest("A bookmark may have at most 100 tags")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, s := range raw {
		v, e := NormalizeTag(s)
		if e != nil {
			return nil, e
		}
		if !seen[v] {
			out = append(out, v)
			seen[v] = true
		}
	}
	return out, nil
}
func Subject(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if len(v) > 8192 {
		return "", ErrInvalidURL
	}
	if strings.HasPrefix(v, "at://") {
		if _, _, _, e := ParseURI(v); e == nil {
			return v, nil
		}
		return "", ErrInvalidURL
	}
	if _, e := NormalizeURL(v); e != nil {
		return "", e
	}
	return v, nil
}
func ParseURI(uri string) (did, collection, key string, err error) {
	if !strings.HasPrefix(uri, "at://") {
		err = ErrInvalidRecord
		return
	}
	parts := strings.Split(strings.TrimPrefix(uri, "at://"), "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		err = ErrInvalidRecord
		return
	}
	return parts[0], parts[1], parts[2], nil
}
func (l Library) key(uri, collection string) (string, error) {
	did, col, key, e := ParseURI(uri)
	if e != nil || did != l.Repo.DID() || col != collection {
		return "", ErrNotFound
	}
	return key, nil
}
func text(v map[string]any, k string) string { s, _ := v[k].(string); return s }
func tags(v map[string]any) []string {
	switch a := v["tags"].(type) {
	case []string:
		return a
	case []any:
		out := []string{}
		for _, v := range a {
			if s, ok := v.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
func clone(v map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range v {
		out[k] = v
	}
	return out
}
func setTags(v map[string]any, t []string) {
	if len(t) == 0 {
		delete(v, "tags")
	} else {
		v["tags"] = t
	}
}
func contains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}
func unique(a []string) []string {
	out := []string{}
	for _, v := range a {
		if !contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}
func clamp(v, max int) int {
	if v < 1 {
		return 1
	}
	if v > max {
		return max
	}
	return v
}
func (l Library) all(ctx context.Context, col string) ([]Record, error) {
	out := []Record{}
	cursor := ""
	seen := map[string]bool{}
	for {
		p, e := l.Repo.List(ctx, col, 100, cursor)
		if e != nil {
			return nil, e
		}
		out = append(out, p.Records...)
		if p.Cursor == "" {
			return out, nil
		}
		if seen[p.Cursor] {
			return nil, fmt.Errorf("%w: repeated pagination cursor", ErrInvalidRecord)
		}
		seen[p.Cursor] = true
		cursor = p.Cursor
	}
}
