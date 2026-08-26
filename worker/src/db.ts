import type { RawListing } from './sources/types';

function makeId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

export async function upsertListing(db: D1Database, listing: RawListing, score: number): Promise<void> {
  const id = makeId(listing.source, listing.externalId);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO listings
        (id, source, external_id, title, company, location, remote, url, description, salary_min, salary_max, posted_at, fetched_at, score, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'new')
       ON CONFLICT(source, external_id) DO UPDATE SET
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
         score = excluded.score`
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
      score
    )
    .run();
}

export async function getListings(
  db: D1Database,
  opts: { status?: string; minScore?: number; limit?: number }
) {
  const limit = opts.limit ?? 100;
  let query = 'SELECT * FROM listings WHERE 1=1';
  const binds: unknown[] = [];

  if (opts.status) {
    query += ' AND status = ?';
    binds.push(opts.status);
  }
  if (opts.minScore !== undefined) {
    query += ' AND score >= ?';
    binds.push(opts.minScore);
  }
  query += ' ORDER BY score DESC, fetched_at DESC LIMIT ?';
  binds.push(limit);

  const { results } = await db.prepare(query).bind(...binds).all();
  return results;
}

export async function setListingStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare('UPDATE listings SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function recordSyncRun(
  db: D1Database,
  startedAt: string,
  finishedAt: string,
  ok: string[],
  failed: string[],
  newCount: number
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sync_runs (started_at, finished_at, sources_ok, sources_failed, new_count) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(startedAt, finishedAt, ok.join(','), failed.join(','), newCount)
    .run();
}
