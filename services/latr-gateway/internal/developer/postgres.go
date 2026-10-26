package developer

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func dbError(err error) error {
	if err == nil {
		return nil
	}
	var gateway *Error
	if errors.As(err, &gateway) {
		return err
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return fail(409, "client_exists", "Gateway client already exists")
	}
	return fail(500, "database_error", "Database error")
}

const clientColumns = "client_id,owner_did,display_name,is_official,billing_status,stripe_customer_id,daily_request_limit,created_at"

func scanClient(row pgx.Row) (Client, error) {
	var c Client
	var created time.Time
	err := row.Scan(&c.ClientID, &c.OwnerDID, &c.DisplayName, &c.IsOfficial, &c.BillingStatus, &c.StripeCustomerID, &c.DailyRequestLimit, &created)
	c.CreatedAt = created.UTC().Format(time.RFC3339)
	if c.DailyRequestLimit == math.MaxInt32 {
		c.DailyRequestLimit = math.MaxInt64
	}
	return c, err
}
func scanKey(row pgx.Row) (Key, error) {
	var k Key
	var created time.Time
	var revoked *time.Time
	err := row.Scan(&k.KeyID, &k.ClientID, &k.KeyHash, &k.Label, &created, &revoked)
	k.CreatedAt = created.UTC().Format(time.RFC3339)
	if revoked != nil {
		value := revoked.UTC().Format(time.RFC3339)
		k.RevokedAt = &value
	}
	return k, err
}
func (s *Store) resolvePostgres(ctx context.Context, h http.Header) (string, error) {
	id, key := strings.TrimSpace(h.Get("X-Latr-Client-Id")), strings.TrimSpace(h.Get("X-Latr-API-Key"))
	if id != "" && key != "" {
		if expected, ok := s.official[id]; ok {
			if equal(HashCredential(key), HashCredential(expected)) {
				return id, nil
			}
			return "", fail(403, "invalid_client_credential", "Invalid API key")
		}
		var exists bool
		if err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM developer_clients WHERE client_id=$1)", id).Scan(&exists); err != nil {
			return "", dbError(err)
		}
		if !exists {
			return "", fail(403, "unknown_client", "Unknown gateway client")
		}
		if err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM developer_api_keys WHERE client_id=$1 AND key_hash=$2 AND revoked_at IS NULL)", id, HashCredential(key)).Scan(&exists); err != nil {
			return "", dbError(err)
		}
		if exists {
			return id, nil
		}
		return "", fail(403, "invalid_client_credential", "Invalid API key")
	}
	if legacy := strings.TrimSpace(h.Get("X-Latr-Official-Client")); legacy != "" {
		for id, expected := range s.official {
			if equal(legacy, expected) {
				return id, nil
			}
		}
		err := s.pool.QueryRow(ctx, "SELECT client_id FROM developer_api_keys WHERE key_hash=$1 AND revoked_at IS NULL LIMIT 1", HashCredential(legacy)).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", dbError(err)
		}
	}
	if len(s.official) == 0 {
		var exists bool
		if err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM developer_clients)").Scan(&exists); err != nil {
			return "", dbError(err)
		}
		if !exists {
			return "", fail(403, "client_credential_policy", "Gateway client credential policy enabled but no clients configured")
		}
	}
	return "", fail(403, "invalid_client_credential", "Invalid gateway client credentials")
}
func (s *Store) listClientsPostgres(ctx context.Context, owner string) ([]Client, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+clientColumns+" FROM developer_clients WHERE owner_did=$1 ORDER BY client_id", owner)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []Client{}
	for rows.Next() {
		c, err := scanClient(rows)
		if err != nil {
			return nil, dbError(err)
		}
		out = append(out, c)
	}
	return out, dbError(rows.Err())
}
func (s *Store) createClientPostgres(ctx context.Context, owner, id string, name *string, official bool) (Client, error) {
	limit, billing := int64(10000), "preview"
	if official {
		limit = math.MaxInt32
		billing = "internal"
	}
	c, err := scanClient(s.pool.QueryRow(ctx, "INSERT INTO developer_clients (client_id,owner_did,display_name,is_official,billing_status,daily_request_limit) VALUES ($1,$2,$3,$4,$5,$6) RETURNING "+clientColumns, id, owner, name, official, billing, limit))
	return c, dbError(err)
}
func (s *Store) ownerPostgres(ctx context.Context, owner, id string) error {
	var actual string
	err := s.pool.QueryRow(ctx, "SELECT owner_did FROM developer_clients WHERE client_id=$1", id).Scan(&actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return fail(404, "client_not_found", "Gateway client not found")
	}
	if err != nil {
		return dbError(err)
	}
	if actual != owner {
		return fail(403, "forbidden", "Not authorized for this client")
	}
	return nil
}
func (s *Store) deleteClientPostgres(ctx context.Context, owner, id string) error {
	if err := s.ownerPostgres(ctx, owner, id); err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, "DELETE FROM developer_clients WHERE client_id=$1 AND owner_did=$2", id, owner)
	if err != nil {
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return fail(404, "client_not_found", "Gateway client not found")
	}
	return nil
}

const keyColumns = "key_id,client_id,key_hash,label,created_at,revoked_at"

func (s *Store) listKeysPostgres(ctx context.Context, owner, id string) ([]Key, error) {
	if err := s.ownerPostgres(ctx, owner, id); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, "SELECT "+keyColumns+" FROM developer_api_keys WHERE client_id=$1 ORDER BY created_at", id)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []Key{}
	for rows.Next() {
		key, err := scanKey(rows)
		if err != nil {
			return nil, dbError(err)
		}
		out = append(out, key)
	}
	return out, dbError(rows.Err())
}
func (s *Store) createKeyPostgres(ctx context.Context, owner, id string, label *string) (Key, string, error) {
	if err := s.ownerPostgres(ctx, owner, id); err != nil {
		return Key{}, "", err
	}
	keyID, secret, err := newKey()
	if err != nil {
		return Key{}, "", err
	}
	key, err := scanKey(s.pool.QueryRow(ctx, "INSERT INTO developer_api_keys (key_id,client_id,key_hash,label) VALUES ($1,$2,$3,$4) RETURNING "+keyColumns, keyID, id, HashCredential(secret), optional(label)))
	return key, secret, dbError(err)
}
func (s *Store) revokeKeyPostgres(ctx context.Context, owner, id, keyID string) error {
	if err := s.ownerPostgres(ctx, owner, id); err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, "UPDATE developer_api_keys SET revoked_at=NOW() WHERE client_id=$1 AND key_id=$2 AND revoked_at IS NULL", id, keyID)
	if err != nil {
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return fail(404, "key_not_found", "API key not found")
	}
	return nil
}
func (s *Store) recordUsagePostgres(ctx context.Context, id, family string) error {
	if _, ok := s.official[id]; ok {
		return nil
	}
	_, err := s.pool.Exec(ctx, "INSERT INTO developer_usage_daily (client_id,usage_date,route_family,request_count) VALUES ($1,$2::date,$3,1) ON CONFLICT (client_id,usage_date,route_family) DO UPDATE SET request_count=developer_usage_daily.request_count+1", id, s.today(), family)
	return dbError(err)
}
func (s *Store) limitPostgres(ctx context.Context, id string) error {
	if _, ok := s.official[id]; ok {
		return nil
	}
	var limit, total int64
	err := s.pool.QueryRow(ctx, "SELECT c.daily_request_limit,COALESCE(SUM(u.request_count),0) FROM developer_clients c LEFT JOIN developer_usage_daily u ON u.client_id=c.client_id AND u.usage_date=$2::date WHERE c.client_id=$1 GROUP BY c.daily_request_limit", id, s.today()).Scan(&limit, &total)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return dbError(err)
	}
	if limit != math.MaxInt32 && total >= limit {
		return fail(429, "usage_limit_exceeded", "Daily request limit exceeded for client")
	}
	return nil
}
func (s *Store) usagePostgres(ctx context.Context, owner string) ([]UsageSummary, error) {
	clients, err := s.listClientsPostgres(ctx, owner)
	if err != nil {
		return nil, err
	}
	out := []UsageSummary{}
	for _, c := range clients {
		rows, err := s.pool.Query(ctx, "SELECT route_family,request_count FROM developer_usage_daily WHERE client_id=$1 AND usage_date=$2::date", c.ClientID, s.today())
		if err != nil {
			return nil, dbError(err)
		}
		counts := map[string]int64{}
		for rows.Next() {
			var family string
			var count int64
			if err = rows.Scan(&family, &count); err != nil {
				rows.Close()
				return nil, dbError(err)
			}
			counts[family] = count
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, dbError(err)
		}
		out = append(out, summary(c, s.today(), counts))
	}
	return out, nil
}
