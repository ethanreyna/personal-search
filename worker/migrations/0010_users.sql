-- Accounts with their own criteria, profile document, listings and outputs.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- NULL for the original account until its first sign-in with the old shared password.
  pass_hash TEXT,
  created_at TEXT NOT NULL,
  criteria_json TEXT,
  document_json TEXT
);
INSERT OR IGNORE INTO users (id, username, created_at) VALUES (1, 'ethan', datetime('now'));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Documents and letters made from a title and description typed in by hand.
CREATE TABLE IF NOT EXISTS personalizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  description TEXT NOT NULL,
  tailored_doc TEXT,
  letter_body TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personalizations_user ON personalizations(user_id, created_at DESC);

ALTER TABLE sync_runs ADD COLUMN user_id INTEGER;

-- Listings become per account: rebuild with user_id in the unique key.
-- Existing rows belong to the original account.
CREATE TABLE listings_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  remote INTEGER DEFAULT 0,
  url TEXT NOT NULL,
  description TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  posted_at TEXT,
  fetched_at TEXT NOT NULL,
  score REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  applicants INTEGER,
  poster_name TEXT,
  poster_title TEXT,
  poster_url TEXT,
  company_website TEXT,
  contact_email TEXT,
  contact_status TEXT,
  contact_score INTEGER,
  draft_subject TEXT,
  draft_body TEXT,
  min_years INTEGER,
  years_checked INTEGER NOT NULL DEFAULT 0,
  match_notes TEXT,
  score_version TEXT,
  desc_norm TEXT,
  norm_checked INTEGER NOT NULL DEFAULT 0,
  english INTEGER,
  tailored_doc TEXT,
  letter_body TEXT,
  UNIQUE(user_id, source, external_id)
);

INSERT INTO listings_new (
  id, user_id, source, external_id, title, company, location, remote, url, description, salary_min, salary_max,
  posted_at, fetched_at, score, status, applicants, poster_name, poster_title, poster_url, company_website,
  contact_email, contact_status, contact_score, draft_subject, draft_body, min_years, years_checked, match_notes,
  score_version, desc_norm, norm_checked, english, tailored_doc, letter_body)
SELECT
  '1:' || id, 1, source, external_id, title, company, location, remote, url, description, salary_min, salary_max,
  posted_at, fetched_at, score, status, applicants, poster_name, poster_title, poster_url, company_website,
  contact_email, contact_status, contact_score, draft_subject, draft_body, min_years, years_checked, match_notes,
  score_version, desc_norm, norm_checked, english, tailored_doc, letter_body
FROM listings;

DROP TABLE listings;
ALTER TABLE listings_new RENAME TO listings;

CREATE INDEX IF NOT EXISTS idx_listings_user_score ON listings(user_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_user_status ON listings(user_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_user_posted ON listings(user_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_user_version ON listings(user_id, score_version);
CREATE INDEX IF NOT EXISTS idx_listings_fetched ON listings(fetched_at);
