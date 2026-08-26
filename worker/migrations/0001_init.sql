CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
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
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_score ON listings(score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_fetched ON listings(fetched_at DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sources_ok TEXT,
  sources_failed TEXT,
  new_count INTEGER DEFAULT 0
);
