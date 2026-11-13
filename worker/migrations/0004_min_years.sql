-- Minimum years of experience parsed from the description (NULL = not stated).
ALTER TABLE listings ADD COLUMN min_years INTEGER;
-- 0 until the description has been parsed, so existing rows get backfilled.
ALTER TABLE listings ADD COLUMN years_checked INTEGER NOT NULL DEFAULT 0;
