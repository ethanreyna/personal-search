-- When a listing was first stored (fetched_at moves on every re-fetch).
ALTER TABLE listings ADD COLUMN first_seen TEXT;
UPDATE listings SET first_seen = fetched_at WHERE first_seen IS NULL;

-- Computed with the match score: flags (JSON), tier, and the reasons shown on the card.
ALTER TABLE listings ADD COLUMN flags TEXT;
ALTER TABLE listings ADD COLUMN tier TEXT;
ALTER TABLE listings ADD COLUMN why TEXT;
ALTER TABLE listings ADD COLUMN to_check TEXT;

-- The same posting seen on several sources: later copies point at the first.
ALTER TABLE listings ADD COLUMN dupe_key TEXT;
ALTER TABLE listings ADD COLUMN duplicate_of TEXT;

-- Whether the posting is still up: 'open', 'closed', or NULL when not checked.
ALTER TABLE listings ADD COLUMN open_status TEXT;
ALTER TABLE listings ADD COLUMN checked_at TEXT;
ALTER TABLE listings ADD COLUMN closes_at TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_user_first_seen ON listings(user_id, first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_listings_user_dupe ON listings(user_id, dupe_key);
CREATE INDEX IF NOT EXISTS idx_listings_duplicate_of ON listings(duplicate_of);

-- The scheduled sync handles one account per run, oldest first.
ALTER TABLE users ADD COLUMN last_synced_at TEXT;
