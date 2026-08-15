-- Derived OpenGraph cache. No account/DID association is stored.
CREATE TABLE IF NOT EXISTS bookmark_previews (
    subject_hash TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    title TEXT,
    description TEXT,
    image_url TEXT,
    site_name TEXT,
    author TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS bookmark_previews_expires_at_idx
    ON bookmark_previews (expires_at);
