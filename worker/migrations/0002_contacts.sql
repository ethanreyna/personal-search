-- Extra detail some sources provide (applicant count, the person who posted
-- the listing), plus contact lookup results and a saved outreach draft.
ALTER TABLE listings ADD COLUMN applicants INTEGER;
ALTER TABLE listings ADD COLUMN poster_name TEXT;
ALTER TABLE listings ADD COLUMN poster_title TEXT;
ALTER TABLE listings ADD COLUMN poster_url TEXT;
ALTER TABLE listings ADD COLUMN company_website TEXT;
ALTER TABLE listings ADD COLUMN contact_email TEXT;
ALTER TABLE listings ADD COLUMN contact_status TEXT;
ALTER TABLE listings ADD COLUMN draft_subject TEXT;
ALTER TABLE listings ADD COLUMN draft_body TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_posted ON listings(posted_at DESC);
