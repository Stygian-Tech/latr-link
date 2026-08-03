-- LatrKit developer console schema (Postgres / DATABASE_URL)

CREATE TABLE IF NOT EXISTS developer_clients (
    client_id TEXT PRIMARY KEY,
    owner_did TEXT NOT NULL,
    display_name TEXT,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    billing_status TEXT NOT NULL DEFAULT 'preview',
    stripe_customer_id TEXT,
    daily_request_limit INTEGER NOT NULL DEFAULT 10000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS developer_clients_owner_did_idx
    ON developer_clients (owner_did);

CREATE TABLE IF NOT EXISTS developer_api_keys (
    key_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES developer_clients (client_id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_api_keys_client_id_idx
    ON developer_api_keys (client_id);

CREATE INDEX IF NOT EXISTS developer_api_keys_key_hash_idx
    ON developer_api_keys (key_hash);

CREATE TABLE IF NOT EXISTS developer_usage_daily (
    client_id TEXT NOT NULL REFERENCES developer_clients (client_id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    route_family TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client_id, usage_date, route_family)
);
