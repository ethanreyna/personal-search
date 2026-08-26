import { Hono } from 'hono';
import type { Env } from './sources/types';
import { fetchAllSources } from './sources';
import { scoreListing } from './match';
import { upsertListing, getListings, setListingStatus, recordSyncRun } from './db';
// Private, gitignored — holds your actual target titles/skills/locations. See worker/criteria.example.json for the template.
import criteria from '../criteria.json';

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

app.get('/api/listings', async (c) => {
  const status = c.req.query('status') || undefined;
  const minScoreRaw = c.req.query('minScore');
  const limitRaw = c.req.query('limit');
  const rows = await getListings(c.env.DB, {
    status,
    minScore: minScoreRaw ? Number(minScoreRaw) : undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  return c.json(rows);
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
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

async function runSync(env: Env) {
  const startedAt = new Date().toISOString();
  const { listings, ok, failed } = await fetchAllSources(env, criteria as any);

  for (const listing of listings) {
    const score = scoreListing(listing, criteria as any);
    await upsertListing(env.DB, listing, score);
  }

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
