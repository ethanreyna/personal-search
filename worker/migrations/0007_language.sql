-- 1 when the listing text looks English, 0 when it doesn't, NULL until checked.
ALTER TABLE listings ADD COLUMN english INTEGER;
