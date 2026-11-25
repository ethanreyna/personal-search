import type { BoardResult } from './sources/boards';

// Whether a posting is still up. Employer boards answer this directly (a
// posting missing from its board is gone); other sources are checked by
// opening the posting page and looking for the usual "closed" wording.

const CLOSED_TEXT =
  /no longer accepting applications|no longer available|this (?:job|position|posting|role) (?:has )?(?:expired|been filled|is closed|is no longer)|position has been filled|posting (?:has )?(?:closed|expired)|job not found|page (?:you(?:'re| are) looking for )?(?:could not be found|does not exist)/i;

// Sources whose pages block automated requests, so a check would say nothing.
const UNCHECKABLE = new Set(['linkedin']);

export type OpenStatus = 'open' | 'closed' | null;

/** Opens the posting page. Null when the answer isn't clear (blocked, rate limited, error). */
export async function checkPosting(url: string, source: string): Promise<OpenStatus> {
  if (UNCHECKABLE.has(source)) return null;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-search/1.0)', Accept: 'text/html' },
    });
    if (res.status === 404 || res.status === 410) return 'closed';
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 300_000);
    return CLOSED_TEXT.test(body) ? 'closed' : 'open';
  } catch {
    return null;
  }
}

/** Board postings stored earlier that are no longer on their board are closed. */
export async function closeMissingBoardPostings(db: D1Database, userId: number, boards: BoardResult[]): Promise<number> {
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE listings SET open_status = 'closed', checked_at = ? WHERE id = ?");
  let closed = 0;
  for (const b of boards) {
    const live = new Set(b.allIds);
    const { results } = await db
      .prepare(
        `SELECT id, external_id FROM listings
         WHERE user_id = ? AND source = ? AND external_id LIKE ? AND coalesce(open_status, '') != 'closed'`
      )
      .bind(userId, b.board.kind, `${b.board.name}:%`)
      .all<{ id: string; external_id: string }>();
    const gone = results.filter((r) => !live.has(r.external_id));
    if (gone.length) await db.batch(gone.map((r) => stmt.bind(now, r.id)));
    closed += gone.length;
  }
  return closed;
}

/** Closes postings whose stated closing date has passed. */
export async function closeExpired(db: D1Database, userId: number): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE listings SET open_status = 'closed', checked_at = ?
       WHERE user_id = ? AND closes_at IS NOT NULL AND closes_at < ? AND coalesce(open_status, '') != 'closed'`
    )
    .bind(now, userId, now)
    .run();
}

/**
 * Checks a few of the best unchecked (or stale) listings that are still in
 * play. Capped because each check is an outbound request.
 */
export async function checkSome(db: D1Database, userId: number, limit = 8): Promise<number> {
  const stale = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, url, source FROM listings
       WHERE user_id = ? AND status IN ('new', 'saved') AND duplicate_of IS NULL AND tier IN ('top', 'second')
         AND source NOT IN ('linkedin', 'greenhouse', 'lever', 'ashby', 'federal')
         AND coalesce(open_status, '') != 'closed' AND (checked_at IS NULL OR checked_at < ?)
       ORDER BY score DESC LIMIT ?`
    )
    .bind(userId, stale, limit)
    .all<{ id: string; url: string; source: string }>();
  const now = new Date().toISOString();
  const updates = await Promise.all(
    results.map(async (r) => {
      const status = await checkPosting(r.url, r.source);
      return db
        .prepare('UPDATE listings SET open_status = coalesce(?, open_status), checked_at = ? WHERE id = ?')
        .bind(status, now, r.id);
    })
  );
  if (updates.length) await db.batch(updates);
  return updates.length;
}
