import type { Criteria, RawListing } from './sources/types';
import { looksEnglish, minYearsRequired, normalizeText } from './experience';

const isEnglish = (title: string, description: string | null | undefined) =>
  looksEnglish(normalizeText(`${title} ${description ?? ''}`)) ? 1 : 0;
import { matchListing, matchVersion } from './match';

function makeId(userId: number, source: string, externalId: string): string {
  return `${userId}:${source}:${externalId}`;
}

export async function upsertListing(db: D1Database, userId: number, listing: RawListing, criteria: Criteria): Promise<string> {
  const id = makeId(userId, listing.source, listing.externalId);
  const now = new Date().toISOString();
  const minYears = minYearsRequired(listing.description);
  const match = matchListing(listing, criteria, minYears);

  // Contact lookups, drafts and status are intentionally left out of the
  // conflict update so re-fetching a listing never wipes them.
  await db
    .prepare(
      `INSERT INTO listings
        (id, user_id, source, external_id, title, company, location, remote, url, description, salary_min, salary_max, posted_at, fetched_at, score, status,
         applicants, poster_name, poster_title, poster_url, company_website, min_years, years_checked,
         match_notes, score_version, desc_norm, norm_checked, english)
       VALUES (?1, ?25, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'new', ?15, ?16, ?17, ?18, ?19, ?20, 1, ?21, ?22, ?23, 1, ?24)
       ON CONFLICT(user_id, source, external_id) DO UPDATE SET
         title = excluded.title,
         company = excluded.company,
         location = excluded.location,
         remote = excluded.remote,
         url = excluded.url,
         description = excluded.description,
         salary_min = excluded.salary_min,
         salary_max = excluded.salary_max,
         posted_at = excluded.posted_at,
         fetched_at = excluded.fetched_at,
         score = excluded.score,
         applicants = excluded.applicants,
         poster_name = COALESCE(excluded.poster_name, listings.poster_name),
         poster_title = COALESCE(excluded.poster_title, listings.poster_title),
         poster_url = COALESCE(excluded.poster_url, listings.poster_url),
         company_website = COALESCE(excluded.company_website, listings.company_website),
         min_years = excluded.min_years,
         years_checked = 1,
         match_notes = excluded.match_notes,
         score_version = excluded.score_version,
         desc_norm = excluded.desc_norm,
         norm_checked = 1,
         english = excluded.english`
    )
    .bind(
      id,
      listing.source,
      listing.externalId,
      listing.title,
      listing.company ?? null,
      listing.location ?? null,
      listing.remote ? 1 : 0,
      listing.url,
      listing.description ?? null,
      listing.salaryMin ?? null,
      listing.salaryMax ?? null,
      listing.postedAt ?? null,
      now,
      match.score,
      listing.applicants ?? null,
      listing.posterName ?? null,
      listing.posterTitle ?? null,
      listing.posterUrl ?? null,
      listing.companyWebsite ?? null,
      minYears,
      match.notes,
      matchVersion(criteria),
      normalizeText(listing.description),
      isEnglish(listing.title, listing.description),
      userId
    )
    .run();
  return id;
}

/** Recomputes match % for rows scored with older criteria or an older formula. */
export async function rescoreListings(
  db: D1Database,
  userId: number,
  criteria: Criteria,
  batchSize = 100,
  maxBatches = 2
): Promise<number> {
  const version = matchVersion(criteria);
  const stmt = db.prepare('UPDATE listings SET score = ?, match_notes = ?, score_version = ? WHERE id = ?');
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const { results } = await db
      .prepare(
        `SELECT id, source, external_id, title, location, remote, url, description, min_years
         FROM listings WHERE user_id = ? AND years_checked = 1 AND (score_version IS NULL OR score_version != ?) LIMIT ?`
      )
      .bind(userId, version, batchSize)
      .all<{ id: string; source: string; external_id: string; title: string; location: string | null;
             remote: number; url: string; description: string | null; min_years: number | null }>();
    if (!results.length) break;
    await db.batch(
      results.map((r) => {
        const m = matchListing(
          { source: r.source, externalId: r.external_id, title: r.title, url: r.url,
            location: r.location ?? undefined, remote: !!r.remote, description: r.description ?? undefined },
          criteria,
          r.min_years
        );
        return stmt.bind(m.score, m.notes, version, r.id);
      })
    );
    total += results.length;
    if (results.length < batchSize) break;
  }
  return total;
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
};

export async function getListings(db: D1Database, userId: number, opts: ListingFilters) {
  const limit = opts.limit ?? 100;
  // Explicit columns: leaves out the normalized text and the stored document body.
  let query = `SELECT id, source, external_id, title, company, location, remote, url, description, salary_min,
      salary_max, posted_at, fetched_at, score, status, applicants, poster_name, poster_title, poster_url,
      company_website, contact_email, contact_status, contact_score, min_years, match_notes, draft_subject,
      draft_body, (tailored_doc IS NOT NULL) AS has_document, (letter_body IS NOT NULL) AS has_letter
    FROM listings WHERE user_id = ?`;
  const binds: unknown[] = [userId];

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
