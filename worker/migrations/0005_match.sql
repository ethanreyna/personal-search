-- Match notes and the criteria version the score was computed with, so
-- scores are recomputed when the criteria change.
ALTER TABLE listings ADD COLUMN match_notes TEXT;
ALTER TABLE listings ADD COLUMN score_version TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_score_version ON listings(score_version);
