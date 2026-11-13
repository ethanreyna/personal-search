import { Hono } from 'hono';
import type { Env, SearchParams } from './sources/types';
import { fetchAllSources, searchSources } from './sources';
import { findPosterEmail } from './contact';
import { draftOutreach } from './draft';
import { parseWordList } from './experience';
import {
  backfillDerived,
  rescoreListings,
  pruneStale,
  upsertListing,
  getListings,
  getListing,
  setListingStatus,
  setContact,
  setDraft,
  recordSyncRun,
} from './db';
import { getCriteria } from './criteria';

const app = new Hono<{ Bindings: Env }>();

// Every request must authenticate first — this app is not meant to be publicly browsable.
app.use('*', async (c, next) => {
  const header = c.req.header('Authorization');
  const expected = 'Basic ' + btoa(`ethan:${c.env.ACCESS_PASSWORD ?? ''}`);
  if (!c.env.ACCESS_PASSWORD || header !== expected) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="restricted"' },
    });
  }
  await next();
});

const num = (v: string | undefined) => (v && !isNaN(Number(v)) ? Number(v) : undefined);

app.get('/api/listings', async (c) => {
  const q = (k: string) => c.req.query(k) || undefined;
  // Catch up rows stored before experience parsing existed, and re-score
  // anything computed with older criteria. Both are no-ops once done.
  await backfillDerived(c.env.DB);
  await rescoreListings(c.env.DB, getCriteria(c.env));
  const rows = await getListings(c.env.DB, {
    status: q('status'),
    minScore: num(q('minScore')),
    limit: num(q('limit')),
    source: q('source'),
    maxApplicants: num(q('maxApplicants')),
    strictApplicants: q('strictApplicants') === '1',
    postedWithinDays: num(q('postedWithinDays')),
    hasPoster: q('hasPoster') === '1',
    maxYears: num(q('maxYears')),
    excludeTitleWords: parseWordList(q('excludeTitle')),
    excludeDescriptionWords: parseWordList(q('excludeText')),
    sort: q('sort'),
  });
  return c.json(rows);
});

// On-demand keyword search across every configured source. Posting age,
// location and remote are passed to each source; the applicant cap and word
// filters are applied when listing results.
app.post('/api/search', async (c) => {
  const body = await c.req.json<SearchParams>();
  if (!body.keywords?.trim()) return c.json({ error: 'keywords required' }, 400);

  const startedAt = new Date().toISOString();
  const criteria = getCriteria(c.env);
  const result = await searchSources(c.env, { ...body, keywords: body.keywords.trim() });
  for (const l of result.listings) {
    await upsertListing(c.env.DB, l, criteria);
  }
  await backfillDerived(c.env.DB);
  await recordSyncRun(c.env.DB, startedAt, new Date().toISOString(), result.ok, result.failed, result.listings.length);

  const summary = {
    processed: result.listings.length,
    counts: result.counts,
    errors: result.errors,
  };
  return c.json(summary, result.ok.length === 0 ? 502 : 200);
});

app.post('/api/listings/:id/contact', async (c) => {
  const id = c.req.param('id');
  const row = await getListing(c.env.DB, id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const result = await findPosterEmail(c.env, row as any);
  // Don't persist transient errors (bad key, rate limit) so a retry is possible.
  if (result.status !== 'error') {
    await setContact(c.env.DB, id, result.email, result.status, result.score ?? null);
  }
  return c.json(result, result.status === 'error' ? 502 : 200);
});

app.post('/api/listings/:id/draft', async (c) => {
  const id = c.req.param('id');
  const row = await getListing(c.env.DB, id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const profile = c.env.CRITERIA_JSON ? getCriteria(c.env).outreach : undefined;
  if (!profile?.name || !profile.background?.length) {
    return c.json(
      { error: 'Set the CRITERIA_JSON secret (with an "outreach" section) before drafting' },
      400
    );
  }
  try {
    const draft = await draftOutreach(c.env, profile, row as any);
    await setDraft(c.env.DB, id, draft.subject, draft.body);
    return c.json(draft);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// Save manual edits to a draft.
app.put('/api/listings/:id/draft', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ subject: string; body: string }>();
  await setDraft(c.env.DB, id, body.subject ?? '', body.body ?? '');
  return c.json({ ok: true });
});

app.post('/api/listings/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status: string }>();
  await setListingStatus(c.env.DB, id, body.status);
  return c.json({ ok: true });
});

app.get('/api/stats', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT status, COUNT(*) as count FROM listings GROUP BY status')
    .all();
  return c.json(results);
});

app.post('/api/sync', async (c) => {
  const result = await runSync(c.env);
  return c.json(result);
});

// Anything else falls through to the built frontend.
app.get('*', async (c) => await c.env.ASSETS.fetch(c.req.raw));

async function runSync(env: Env) {
  const startedAt = new Date().toISOString();
  const criteria = getCriteria(env);
  const { listings, ok, failed } = await fetchAllSources(env, criteria);

  for (const listing of listings) {
    await upsertListing(env.DB, listing, criteria);
  }
  await backfillDerived(env.DB);
  await rescoreListings(env.DB, criteria);
  const pruned = await pruneStale(env.DB, 30);
  if (pruned) console.log(`pruned ${pruned} stale listings`);

  const finishedAt = new Date().toISOString();
  await recordSyncRun(env.DB, startedAt, finishedAt, ok, failed, listings.length);

  return { ok, failed, processed: listings.length };
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env));
  },
};
