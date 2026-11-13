-- Description text pre-normalized for word filters (lowercase, tags and
-- punctuation removed, space padded), filled at write time so filtering
-- doesn't have to rewrite every description on each query.
ALTER TABLE listings ADD COLUMN desc_norm TEXT;
ALTER TABLE listings ADD COLUMN norm_checked INTEGER NOT NULL DEFAULT 0;
