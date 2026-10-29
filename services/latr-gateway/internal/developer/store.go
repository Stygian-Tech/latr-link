// Package developer stores client credentials and account-scoped console data.
package developer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Stygian-Tech/latr-link/services/latr-gateway/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string                    { return e.Message }
func (e *Error) HTTPStatus() int                  { return e.Status }
func (e *Error) ErrorCode() string                { return e.Code }
func fail(status int, code, message string) error { return &Error{status, code, message} }

type Client struct {
	ClientID          string  `json:"clientID"`
	OwnerDID          string  `json:"ownerDID"`
	DisplayName       *string `json:"displayName,omitempty"`
	IsOfficial        bool    `json:"isOfficial"`
	BillingStatus     string  `json:"billingStatus"`
	StripeCustomerID  *string `json:"stripeCustomerID,omitempty"`
	DailyRequestLimit int64   `json:"dailyRequestLimit"`
	CreatedAt         string  `json:"createdAt"`
}
type Key struct {
	KeyID     string  `json:"keyID"`
	ClientID  string  `json:"clientID"`
	KeyHash   string  `json:"keyHash"`
	Label     *string `json:"label,omitempty"`
	CreatedAt string  `json:"createdAt"`
	RevokedAt *string `json:"revokedAt,omitempty"`
}
type UsageBucket struct {
	RouteFamily  string `json:"routeFamily"`
	RequestCount int64  `json:"requestCount"`
}
type UsageSummary struct {
	ClientID   string        `json:"clientId"`
	UsageDate  string        `json:"usageDate"`
	Buckets    []UsageBucket `json:"buckets"`
	DailyLimit *int64        `json:"dailyLimit,omitempty"`
	Remaining  *int64        `json:"remaining,omitempty"`
}
type snapshot struct {
	Clients map[string]Client `json:"clients"`
	APIKeys map[string]Key    `json:"apiKeys"`
	Usage   map[string]int64  `json:"usage"`
}
type Store struct {
	mu       sync.Mutex
	data     snapshot
	official map[string]string
	path     string
	pool     *pgxpool.Pool
	Now      func() time.Time
}

func New(ctx context.Context, cfg config.Config, pool *pgxpool.Pool) (*Store, error) {
	s := &Store{official: cfg.OfficialClientCredentials, Now: time.Now}
	s.data = snapshot{map[string]Client{}, map[string]Key{}, map[string]int64{}}
	if cfg.AppEnv != "test" && pool != nil && cfg.DatabaseURL != "" {
		s.pool = pool
		return s, nil
	}
	if cfg.AppEnv != "test" {
		s.path = cfg.DeveloperStorePath
		if data, err := os.ReadFile(s.path); err == nil {
			if err = json.Unmarshal(data, &s.data); err != nil {
				return nil, fmt.Errorf("load developer store: %w", err)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	if s.data.Clients == nil {
		s.data.Clients = map[string]Client{}
	}
	if s.data.APIKeys == nil {
		s.data.APIKeys = map[string]Key{}
	}
	if s.data.Usage == nil {
		s.data.Usage = map[string]int64{}
	}
	for id, credential := range s.official {
		if _, ok := s.data.Clients[id]; !ok {
			s.data.Clients[id] = Client{ClientID: id, OwnerDID: "official:env", IsOfficial: true, BillingStatus: "internal", DailyRequestLimit: math.MaxInt64}
			label := "env"
			s.data.APIKeys["env:"+id] = Key{KeyID: "env:" + id, ClientID: id, KeyHash: HashCredential(credential), Label: &label}
		}
	}
	return s, nil
}
func HashCredential(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func optional(value *string) *string {
	if value == nil {
		return nil
	}
	v := strings.TrimSpace(*value)
	if v == "" {
		return nil
	}
	return &v
}

var clientPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,62}$`)

func NormalizeClientID(value string) (string, error) {
	id := strings.ToLower(strings.TrimSpace(value))
	if id == "" {
		return "", fail(400, "missing_client_id", "clientId is required")
	}
	if !clientPattern.MatchString(id) {
		return "", fail(400, "invalid_client_id", "clientId must start with a letter and contain only lowercase letters, digits, hyphens, and underscores")
	}
	return id, nil
}
func (s *Store) now() string   { return s.Now().UTC().Format(time.RFC3339) }
func (s *Store) today() string { return s.Now().UTC().Format("2006-01-02") }

// mutate holds the lock through durable replacement and rolls memory back if it fails.
func (s *Store) mutate(fn func() error) error {
	before, _ := json.Marshal(s.data)
	if err := fn(); err != nil {
		return err
	}
	if s.path == "" {
		return nil
	}
	err := s.persist()
	if err != nil {
		var restored snapshot
		_ = json.Unmarshal(before, &restored)
		s.data = restored
		return fail(500, "developer_store_persist_failed", "Failed to persist developer store")
	}
	return nil
}
func (s *Store) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(s.path), ".developer-store-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.path)
}
func (s *Store) ResolveClientID(ctx context.Context, headers http.Header, require bool) (string, error) {
	if !require {
		return "", nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.resolvePostgres(ctx, headers)
	}
	id, key := strings.TrimSpace(headers.Get("X-Latr-Client-Id")), strings.TrimSpace(headers.Get("X-Latr-API-Key"))
	if id != "" && key != "" {
		if _, ok := s.data.Clients[id]; !ok {
			return "", fail(403, "unknown_client", "Unknown gateway client")
		}
		hash := HashCredential(key)
		for _, record := range s.data.APIKeys {
			if record.ClientID == id && record.RevokedAt == nil && equal(record.KeyHash, hash) {
				return id, nil
			}
		}
		return "", fail(403, "invalid_client_credential", "Invalid API key")
	}
	legacy := strings.TrimSpace(headers.Get("X-Latr-Official-Client"))
	if legacy != "" {
		for id, expected := range s.official {
			if equal(legacy, expected) {
				return id, nil
			}
		}
		hash := HashCredential(legacy)
		for _, record := range s.data.APIKeys {
			if record.RevokedAt == nil && equal(hash, record.KeyHash) {
				return record.ClientID, nil
			}
		}
	}
	if len(s.official) == 0 && len(s.data.Clients) == 0 {
		return "", fail(403, "client_credential_policy", "Gateway client credential policy enabled but no clients configured")
	}
	return "", fail(403, "invalid_client_credential", "Invalid gateway client credentials")
}
func (s *Store) ListClients(ctx context.Context, owner string) ([]Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.listClientsPostgres(ctx, owner)
	}
	out := []Client{}
	for _, c := range s.data.Clients {
		if c.OwnerDID == owner {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ClientID < out[j].ClientID })
	return out, nil
}
func (s *Store) CreateClient(ctx context.Context, owner, id string, name *string, official bool) (Client, error) {
	id, err := NormalizeClientID(id)
	if err != nil {
		return Client{}, err
	}
	name = optional(name)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.createClientPostgres(ctx, owner, id, name, official)
	}
	c := Client{ClientID: id, OwnerDID: owner, DisplayName: name, IsOfficial: official, BillingStatus: "preview", DailyRequestLimit: 10000, CreatedAt: s.now()}
	if official {
		c.BillingStatus = "internal"
		c.DailyRequestLimit = math.MaxInt64
	}
	err = s.mutate(func() error {
		if _, ok := s.data.Clients[id]; ok {
			return fail(409, "client_exists", "Gateway client already exists")
		}
		s.data.Clients[id] = c
		return nil
	})
	return c, err
}
func (s *Store) assertOwner(owner, id string) error {
	c, ok := s.data.Clients[id]
	if !ok || c.OwnerDID != owner {
		return fail(403, "forbidden", "Not authorized for this client")
	}
	return nil
}
func (s *Store) DeleteClient(ctx context.Context, owner, id string) error {
	id, err := NormalizeClientID(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.deleteClientPostgres(ctx, owner, id)
	}
	return s.mutate(func() error {
		if _, ok := s.data.Clients[id]; !ok {
			return fail(404, "client_not_found", "Gateway client not found")
		}
		if err := s.assertOwner(owner, id); err != nil {
			return err
		}
		delete(s.data.Clients, id)
		for key, r := range s.data.APIKeys {
			if r.ClientID == id {
				delete(s.data.APIKeys, key)
			}
		}
		return nil
	})
}
func (s *Store) ListAPIKeys(ctx context.Context, owner, id string) ([]Key, error) {
	id, err := NormalizeClientID(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.listKeysPostgres(ctx, owner, id)
	}
	if err = s.assertOwner(owner, id); err != nil {
		return nil, err
	}
	out := []Key{}
	for _, k := range s.data.APIKeys {
		if k.ClientID == id && !strings.HasPrefix(k.KeyID, "env:") {
			out = append(out, k)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out, nil
}
func newKey() (string, string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", "", err
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		return "", "", err
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:]), "lk_" + base64.RawURLEncoding.EncodeToString(secret), nil
}
func (s *Store) CreateAPIKey(ctx context.Context, owner, id string, label *string) (Key, string, error) {
	id, err := NormalizeClientID(id)
	if err != nil {
		return Key{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.createKeyPostgres(ctx, owner, id, label)
	}
	if err = s.assertOwner(owner, id); err != nil {
		return Key{}, "", err
	}
	keyID, secret, err := newKey()
	if err != nil {
		return Key{}, "", err
	}
	key := Key{KeyID: keyID, ClientID: id, KeyHash: HashCredential(secret), Label: optional(label), CreatedAt: s.now()}
	err = s.mutate(func() error { s.data.APIKeys[keyID] = key; return nil })
	return key, secret, err
}
func (s *Store) RevokeAPIKey(ctx context.Context, owner, id, keyID string) error {
	id, err := NormalizeClientID(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.revokeKeyPostgres(ctx, owner, id, keyID)
	}
	return s.mutate(func() error {
		if err := s.assertOwner(owner, id); err != nil {
			return err
		}
		key, ok := s.data.APIKeys[keyID]
		if !ok || key.ClientID != id {
			return fail(404, "key_not_found", "API key not found")
		}
		now := s.now()
		key.RevokedAt = &now
		s.data.APIKeys[keyID] = key
		return nil
	})
}
func (s *Store) RecordUsage(ctx context.Context, id, family string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.recordUsagePostgres(ctx, id, family)
	}
	return s.mutate(func() error { s.data.Usage[id+"|"+s.today()+"|"+family]++; return nil })
}
func (s *Store) AssertWithinDailyLimit(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.limitPostgres(ctx, id)
	}
	c, ok := s.data.Clients[id]
	if !ok || c.DailyRequestLimit == math.MaxInt64 {
		return nil
	}
	var total int64
	for key, count := range s.data.Usage {
		if strings.HasPrefix(key, id+"|"+s.today()+"|") {
			total += count
		}
	}
	if total >= c.DailyRequestLimit {
		return fail(429, "usage_limit_exceeded", "Daily request limit exceeded for client")
	}
	return nil
}
func (s *Store) UsageSummaries(ctx context.Context, owner string) ([]UsageSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pool != nil {
		return s.usagePostgres(ctx, owner)
	}
	out := []UsageSummary{}
	for _, c := range s.data.Clients {
		if c.OwnerDID != owner {
			continue
		}
		counts := map[string]int64{}
		for key, count := range s.data.Usage {
			prefix := c.ClientID + "|" + s.today() + "|"
			if strings.HasPrefix(key, prefix) {
				counts[strings.TrimPrefix(key, prefix)] = count
			}
		}
		out = append(out, summary(c, s.today(), counts))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ClientID < out[j].ClientID })
	return out, nil
}
func summary(c Client, date string, counts map[string]int64) UsageSummary {
	u := UsageSummary{ClientID: c.ClientID, UsageDate: date, Buckets: []UsageBucket{}}
	var total int64
	for _, family := range []string{"saves", "og-preview", "discover", "auth", "other"} {
		if count := counts[family]; count > 0 {
			u.Buckets = append(u.Buckets, UsageBucket{family, count})
			total += count
		}
	}
	if c.DailyRequestLimit != math.MaxInt64 {
		limit := c.DailyRequestLimit
		remaining := max(int64(0), limit-total)
		u.DailyLimit = &limit
		u.Remaining = &remaining
	}
	return u
}
func RouteFamily(path string) string {
	if i := strings.LastIndex(path, "/xrpc/"); i >= 0 {
		return "xrpc:" + path[i+6:]
	}
	for _, entry := range []struct{ part, family string }{{"/saves", "saves"}, {"/og-preview", "og-preview"}, {"/discover", "discover"}, {"/auth/probe", "auth"}} {
		if strings.Contains(path, entry.part) {
			return entry.family
		}
	}
	return "other"
}
