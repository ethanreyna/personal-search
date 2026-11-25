import type { Criteria, RawListing } from './sources/types';
import { looksEnglish, minYearsRequired, normalizeText } from './experience';

const isEnglish = (title: string, description: string | null | undefined) =>
  looksEnglish(normalizeText(`${title} ${description ?? ''}`)) ? 1 : 0;
import { matchListing, matchVersion } from './match';
import { dupeKey } from './signals';

function makeId(userId: number, source: string, externalId: string): string {
  return `${userId}:${source}:${externalId}`;
}

// Columns written on every fetch, in bind order.
const UPSERT_COLUMNS = [
  'id', 'user_id', 'source', 'external_id', 'title', 'company', 'location', 'remote', 'url', 'description',
  'salary_min', 'salary_max', 'posted_at', 'fetched_at', 'first_seen', 'score', 'applicants', 'poster_name',
  'poster_title', 'poster_url', 'company_website', 'min_years', 'years_checked', 'match_notes', 'score_version',
  'desc_norm', 'norm_checked', 'english', 'flags', 'tier', 'why', 'to_check', 'dupe_key', 'open_status',
  'checked_at', 'closes_at',
] as const;

// Kept from the stored row when the new fetch doesn't have them.
const KEEP_IF_NULL = new Set(['poster_name', 'poster_title', 'poster_url', 'company_website', 'open_status', 'checked_at', 'closes_at']);
// Never overwritten after the first insert.
const INSERT_ONLY = new Set(['id', 'user_id', 'source', 'external_id', 'first_seen']);

const UPSERT_SQL = `INSERT INTO listings (${UPSERT_COLUMNS.join(', ')}) VALUES (${UPSERT_COLUMNS.map(() => '?').join(', ')})
  ON CONFLICT(user_id, source, external_id) DO UPDATE SET ${UPSERT_COLUMNS.filter((c) => !INSERT_ONLY.has(c))
    .map((c) => (KEEP_IF_NULL.has(c) ? `${c} = COALESCE(excluded.${c}, listings.${c})` : `${c} = excluded.${c}`))
    .join(', ')}`;

export async function upsertListing(db: D1Database, userId: number, listing: RawListing, criteria: Criteria): Promise<string> {
  const id = makeId(userId, listing.source, listing.externalId);
  const now = new Date().toISOString();
  const minYears = minYearsRequired(listing.description);
  const m = matchListing(listing, criteria, minYears);
  const closed = listing.closesAt && listing.closesAt < now;

  // Contact lookups, drafts, outputs and status aren't in the column list,
  // so re-fetching a listing never wipes them.
  const values: Record<(typeof UPSERT_COLUMNS)[number], unknown> = {
    id,
    user_id: userId,
    source: listing.source,
    external_id: listing.externalId,
    title: listing.title,
    company: listing.company ?? null,
    location: listing.location ?? null,
    remote: listing.remote ? 1 : 0,
    url: listing.url,
    description: listing.description ?? null,
    salary_min: listing.salaryMin ?? m.parsedPay?.min ?? null,
    salary_max: listing.salaryMax ?? m.parsedPay?.max ?? null,
    posted_at: listing.postedAt ?? null,
    fetched_at: now,
    first_seen: now,
    score: m.score,
    applicants: listing.applicants ?? null,
    poster_name: listing.posterName ?? null,
    poster_title: listing.posterTitle ?? null,
    poster_url: listing.posterUrl ?? null,
    company_website: listing.companyWebsite ?? null,
    min_years: minYears,
    years_checked: 1,
    match_notes: m.notes,
    score_version: matchVersion(criteria),
    desc_norm: normalizeText(listing.description),
    norm_checked: 1,
    english: isEnglish(listing.title, listing.description),
    flags: JSON.stringify(m.flags),
    tier: m.tier,
    why: m.why,
    to_check: m.check,
    dupe_key: dupeKey(listing.title, listing.company),
    open_status: closed ? 'closed' : listing.openNow ? 'open' : null,
    checked_at: closed || listing.openNow ? now : null,
    closes_at: listing.closesAt ?? null,
  };
  await db.prepare(UPSERT_SQL).bind(...UPSERT_COLUMNS.map((c) => values[c])).run();
  return id;
}

/** Recomputes match %, flags and reasons for rows scored with older criteria or an older formula. */
export async function rescoreListings(
  db: D1Database,
  userId: number,
  criteria: Criteria,
  batchSize = 100,
  maxBatches = 2
): Promise<number> {
  const version = matchVersion(criteria);
  const stmt = db.prepare(
    `UPDATE listings SET score = ?, match_notes = ?, score_version = ?, flags = ?, tier = ?, why = ?, to_check = ?,
       salary_min = coalesce(salary_min, ?), salary_max = coalesce(salary_max, ?),
       dupe_key = coalesce(dupe_key, ?) WHERE id = ?`
  );
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { results } = await db
      .prepare(
        `SELECT id, source, external_id, title, company, location, remote, url, description, min_years, salary_min, salary_max
         FROM listings WHERE user_id = ? AND years_checked = 1 AND (score_version IS NULL OR score_version != ?) LIMIT ?`
      )
      .bind(userId, version, batchSize)
      .all<{ id: string; source: string; external_id: string; title: string; company: string | null; location: string | null;
             remote: number; url: string; description: string | null; min_years: number | null;
             salary_min: number | null; salary_max: number | null }>();
    if (!results.length) break;
    await db.batch(
      results.map((r) => {
        const m = matchListing(
          { source: r.source, externalId: r.external_id, title: r.title, url: r.url, company: r.company ?? undefined,
            location: r.location ?? undefined, remote: !!r.remote, description: r.description ?? undefined,
            salaryMin: r.salary_min ?? undefined, salaryMax: r.salary_max ?? undefined },
          criteria,
          r.min_years
        );
        return stmt.bind(
          m.score, m.notes, version, JSON.stringify(m.flags), m.tier, m.why, m.check,
          m.parsedPay?.min ?? null, m.parsedPay?.max ?? null, dupeKey(r.title, r.company), r.id
        );
      })
    );
    total += results.length;
    if (results.length < batchSize) break;
  }
  if (total) await markDuplicates(db, userId);
  return total;
}

/** Points later copies of the same posting (same dupe_key) at the first one seen. */
export async function markDuplicates(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE listings SET duplicate_of = (
         SELECT o.id FROM listings o
         WHERE o.user_id = listings.user_id AND o.dupe_key = listings.dupe_key
           AND (o.first_seen < listings.first_seen OR (o.first_seen = listings.first_seen AND o.id < listings.id))
         ORDER BY o.first_seen, o.id LIMIT 1)
       WHERE user_id = ? AND dupe_key IS NOT NULL`
    )
    .bind(userId)
    .run();
}

/**
 * Fills derived columns (experience asked, normalized description) for rows
 * stored before those columns existed. Capped per call to keep CPU low;
 * remaining rows are picked up on later calls.
 */
export async function backfillDerived(db: D1Database, batchSize = 200, maxBatches = 2): Promise<number> {
  const stmt = db.prepare(
    'UPDATE listings SET min_years = ?, years_checked = 1, desc_norm = ?, norm_checked = 1, english = ? WHERE id = ?'
  );
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { results } = await db
      .prepare('SELECT id, title, description FROM listings WHERE years_checked = 0 OR norm_checked = 0 OR english IS NULL LIMIT ?')
      .bind(batchSize)
      .all<{ id: string; title: string; description: string | null }>();
    if (!results.length) break;
    await db.batch(
      results.map((r) =>
        stmt.bind(minYearsRequired(r.description), normalizeText(r.description), isEnglish(r.title, r.description), r.id)
      )
    );
    total += results.length;
    if (results.length < batchSize) break;
  }
  return total;
}

/**
 * Deletes listings nobody acted on (still "new", no contact or draft) that
 * haven't been seen by a search or sync in `days` days.
 */
export async function pruneStale(db: D1Database, days = 30, batchSize = 1000, maxBatches = 20): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await db
      .prepare(
        `DELETE FROM listings WHERE id IN (
           SELECT id FROM listings
           WHERE status = 'new' AND contact_email IS NULL AND draft_body IS NULL
             AND tailored_doc IS NULL AND letter_body IS NULL AND fetched_at < ?
           LIMIT ?)`
      )
      .bind(cutoff, batchSize)
      .run();
    const n = res.meta.changes ?? 0;
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

// Lowercased text with punctuation and line breaks turned into spaces and
// padded, so "% sr %" matches "Sr. Engineer" but not "Desktop Support".
function normalized(column: string): string {
  let expr = `lower(' ' || coalesce(${column}, '') || ' ')`;
  for (const ch of [',', '.', '(', ')', '-', '/', '|', ':', ';', '!', '?', '"', '&', '[', ']', '*']) {
    expr = `replace(${expr}, '${ch}', ' ')`;
  }
  for (const code of [9, 10, 13]) expr = `replace(${expr}, char(${code}), ' ')`;
  return expr;
}
const NORMALIZED_TITLE = normalized('title');

export interface ListingFilters {
  status?: string;
  minScore?: number;
  limit?: number;
  source?: string;
  /** Listings with an unknown applicant count are kept unless `strictApplicants` is set. */
  maxApplicants?: number;
  strictApplicants?: boolean;
  postedWithinDays?: number;
  hasPoster?: boolean;
  /** Hide listings whose description asks for more than this many years. Unstated is kept. */
  maxYears?: number;
  /** Hide listings whose title contains any of these whole words/phrases (already normalized). */
  excludeTitleWords?: string[];
  /** Hide listings whose description contains any of these whole words/phrases. */
  excludeDescriptionWords?: string[];
  /** Hide listings detected as not English. Unchecked rows are kept. */
  englishOnly?: boolean;
  /** Hide postings known to be closed. */
  hideClosed?: boolean;
  /** Only listings with pay stated. */
  payListed?: boolean;
  /** Include later copies of a posting already seen on another source. */
  includeDuplicates?: boolean;
  tier?: string;
  sort?: string;
}

// Unknown values sort last in every order.
const SORTS: Record<string, string> = {
  score: 'score DESC, fetched_at DESC',
  newest: '(posted_at IS NULL), posted_at DESC, score DESC',
  oldest: '(posted_at IS NULL), posted_at ASC, score DESC',
  applicants: '(applicants IS NULL), applicants ASC, score DESC',
  years: '(min_years IS NULL), min_years ASC, score DESC',
  salary: '(salary_max IS NULL AND salary_min IS NULL), coalesce(salary_max, salary_min) DESC, score DESC',
  company: "(company IS NULL OR company = ''), lower(company) ASC, score DESC",
  first_seen: 'first_seen DESC, score DESC',
};

// Explicit columns: leaves out the normalized text and the stored document body.
export const LISTING_COLUMNS = `id, source, external_id, title, company, location, remote, url, description, salary_min,
  salary_max, posted_at, fetched_at, first_seen, score, status, applicants, poster_name, poster_title, poster_url,
  company_website, contact_email, contact_status, contact_score, min_years, match_notes, draft_subject,
  draft_body, flags, tier, why, to_check, open_status, checked_at, closes_at,
  (tailored_doc IS NOT NULL) AS has_document, (letter_body IS NOT NULL) AS has_letter,
  (SELECT group_concat(DISTINCT d.source) FROM listings d WHERE d.duplicate_of = listings.id) AS also_on`;

export async function getListings(db: D1Database, userId: number, opts: ListingFilters) {
  const limit = opts.limit ?? 100;
  let query = `SELECT ${LISTING_COLUMNS} FROM listings WHERE user_id = ?`;
  const binds: unknown[] = [userId];
  if (!opts.includeDuplicates) query += ' AND duplicate_of IS NULL';
  if (opts.hideClosed) query += " AND coalesce(open_status, '') != 'closed'";
  if (opts.payListed) query += ' AND (salary_min IS NOT NULL OR salary_max IS NOT NULL)';
  if (opts.tier) {
    query += ' AND tier = ?';
    binds.push(opts.tier);
  }

  if (opts.status) {
    query += ' AND status = ?';
    binds.push(opts.status);
  }
  if (opts.minScore !== undefined) {
    query += ' AND score >= ?';
    binds.push(opts.minScore);
  }
  if (opts.source) {
    query += ' AND source = ?';
    binds.push(opts.source);
  }
  if (opts.maxApplicants !== undefined) {
    query += opts.strictApplicants
      ? ' AND applicants IS NOT NULL AND applicants < ?'
      : ' AND (applicants IS NULL OR applicants < ?)';
    binds.push(opts.maxApplicants);
  }
  if (opts.postedWithinDays !== undefined) {
    const cutoff = new Date(Date.now() - opts.postedWithinDays * 86400_000).toISOString();
    query += ' AND posted_at >= ?';
    binds.push(cutoff);
  }
  if (opts.hasPoster) {
    query += ' AND poster_url IS NOT NULL';
  }
  if (opts.maxYears !== undefined) {
    query += ' AND (min_years IS NULL OR min_years <= ?)';
    binds.push(opts.maxYears);
  }
  for (const word of opts.excludeTitleWords ?? []) {
    query += ` AND ${NORMALIZED_TITLE} NOT LIKE ?`;
    binds.push(`% ${word} %`);
  }
  if (opts.englishOnly) query += ' AND coalesce(english, 1) = 1';
  for (const word of opts.excludeDescriptionWords ?? []) {
    query += " AND coalesce(desc_norm, '') NOT LIKE ?";
    binds.push(`% ${word} %`);
  }
  query += ` ORDER BY ${SORTS[opts.sort ?? ''] ?? SORTS.score} LIMIT ?`;
  binds.push(limit);

  const { results } = await db.prepare(query).bind(...binds).all();
  return results;
}

export async function getListing(db: D1Database, userId: number, id: string) {
  return db.prepare('SELECT * FROM listings WHERE id = ? AND user_id = ?').bind(id, userId).first<Record<string, any>>();
}

export async function setListingStatus(db: D1Database, userId: number, id: string, status: string): Promise<void> {
  await db.prepare('UPDATE listings SET status = ? WHERE id = ? AND user_id = ?').bind(status, id, userId).run();
}

export async function setContact(
  db: D1Database,
  userId: number,
  id: string,
  email: string | null,
  status: string,
  score: number | null
): Promise<void> {
  await db
    .prepare('UPDATE listings SET contact_email = ?, contact_status = ?, contact_score = ? WHERE id = ? AND user_id = ?')
    .bind(email, status, score, id, userId)
    .run();
}

export async function setDraft(db: D1Database, userId: number, id: string, subject: string, body: string): Promise<void> {
  await db
    .prepare('UPDATE listings SET draft_subject = ?, draft_body = ? WHERE id = ? AND user_id = ?')
    .bind(subject, body, id, userId)
    .run();
}

export async function recordSyncRun(
  db: D1Database,
  userId: number,
  startedAt: string,
  finishedAt: string,
  ok: string[],
  failed: string[],
  newCount: number
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sync_runs (user_id, started_at, finished_at, sources_ok, sources_failed, new_count) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(userId, startedAt, finishedAt, ok.join(','), failed.join(','), newCount)
    .run();
}

/** Tables that hold a generated document and letter per row: listings, and hand-entered personalizations. */
export type OutputTable = 'listings' | 'personalizations';

export async function setTailoredDocument(db: D1Database, table: OutputTable, userId: number, id: string | number, doc: string) {
  await db.prepare(`UPDATE ${table} SET tailored_doc = ? WHERE id = ? AND user_id = ?`).bind(doc, id, userId).run();
}

export async function setLetter(db: D1Database, table: OutputTable, userId: number, id: string | number, body: string) {
  await db.prepare(`UPDATE ${table} SET letter_body = ? WHERE id = ? AND user_id = ?`).bind(body, id, userId).run();
}

export interface Personalization {
  id: number;
  title: string;
  company: string | null;
  description: string;
  tailored_doc: string | null;
  letter_body: string | null;
  created_at: string;
}

export async function listPersonalizations(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(
      `SELECT id, title, company, created_at, (tailored_doc IS NOT NULL) AS has_document, (letter_body IS NOT NULL) AS has_letter
       FROM personalizations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .bind(userId)
    .all();
  return results;
}

export async function getPersonalization(db: D1Database, userId: number, id: number) {
  return db
    .prepare('SELECT * FROM personalizations WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Personalization>();
}

export async function createPersonalization(
  db: D1Database,
  userId: number,
  p: { title: string; company: string | null; description: string }
): Promise<number> {
  const res = await db
    .prepare('INSERT INTO personalizations (user_id, title, company, description, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, p.title, p.company, p.description, new Date().toISOString())
    .run();
  return Number(res.meta.last_row_id);
}

export async function deletePersonalization(db: D1Database, userId: number, id: number) {
  await db.prepare('DELETE FROM personalizations WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

/** One week (or `days`) of listings first seen, in numbers plus the two lists the digest shows. */
export async function getDigest(db: D1Database, userId: number, days = 7) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000).toISOString();
  const counts = await db
    .prepare(
      `SELECT count(*) AS found,
         sum(duplicate_of IS NULL) AS unique_count,
         sum(duplicate_of IS NULL AND tier IN ('top', 'second')) AS matching,
         sum(duplicate_of IS NULL AND open_status = 'open') AS confirmed_open,
         sum(duplicate_of IS NULL AND open_status = 'closed') AS closed
       FROM listings WHERE user_id = ? AND first_seen >= ?`
    )
    .bind(userId, from)
    .first<{ found: number; unique_count: number; matching: number; confirmed_open: number; closed: number }>();

  const lastRun = await db
    .prepare('SELECT finished_at, sources_ok, sources_failed FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .bind(userId)
    .first<{ finished_at: string; sources_ok: string; sources_failed: string }>();
  const split = (s: string | null | undefined) => (s ? s.split(',').filter(Boolean) : []);

  const list = async (tier: string, limit: number) =>
    (
      await db
        .prepare(
          `SELECT ${LISTING_COLUMNS} FROM listings
           WHERE user_id = ? AND first_seen >= ? AND tier = ? AND duplicate_of IS NULL
             AND status != 'dismissed' AND coalesce(open_status, '') != 'closed'
           ORDER BY score DESC, first_seen DESC LIMIT ?`
        )
        .bind(userId, from, tier, limit)
        .all()
    ).results;

  return {
    from,
    to: to.toISOString(),
    stats: {
      found: counts?.found ?? 0,
      unique: counts?.unique_count ?? 0,
      matching: counts?.matching ?? 0,
      confirmedOpen: counts?.confirmed_open ?? 0,
      closed: counts?.closed ?? 0,
    },
    lastRun: lastRun
      ? { at: lastRun.finished_at, ok: split(lastRun.sources_ok), failed: split(lastRun.sources_failed) }
      : null,
    top: await list('top', 25),
    second: await list('second', 40),
  };
}

export async function setOpenStatus(db: D1Database, userId: number, id: string, status: string | null) {
  await db
    .prepare('UPDATE listings SET open_status = coalesce(?, open_status), checked_at = ? WHERE id = ? AND user_id = ?')
    .bind(status, new Date().toISOString(), id, userId)
    .run();
}

/** The account whose scheduled sync is most overdue, if any is due. */
export async function nextAccountToSync(db: D1Database, everyHours = 4) {
  const due = new Date(Date.now() - everyHours * 3600_000).toISOString();
  return db
    .prepare(
      `SELECT id, criteria_json FROM users WHERE criteria_json IS NOT NULL AND (last_synced_at IS NULL OR last_synced_at < ?)
       ORDER BY last_synced_at IS NOT NULL, last_synced_at LIMIT 1`
    )
    .bind(due)
    .first<{ id: number; criteria_json: string }>();
}

export async function markSynced(db: D1Database, userId: number) {
  await db.prepare('UPDATE users SET last_synced_at = ? WHERE id = ?').bind(new Date().toISOString(), userId).run();
}
