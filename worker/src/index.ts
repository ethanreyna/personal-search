import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, ProfileDocument, SearchParams } from './sources/types';
import { fetchAllSources, searchSources, sourceCatalog } from './sources';
import { checkPosting, checkSome, closeExpired, closeMissingBoardPostings } from './liveness';
import { findPosterEmail } from './contact';
import { draftOutreach } from './draft';
import { tailorDocument } from './document';
import { writeLetter } from './letter';
import { parseWordList } from './experience';
import { importProfilePdf, MAX_PDF_BYTES } from './profile-import';
import { cleanCriteria, cleanDocument } from './profile';
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
  setTailoredDocument,
  setLetter,
  recordSyncRun,
  listPersonalizations,
  getPersonalization,
  createPersonalization,
  deletePersonalization,
  markDuplicates,
  getDigest,
  setOpenStatus,
  nextAccountToSync,
  markSynced,
  type OutputTable,
} from './db';
import { getCriteria, getDocumentSource, savedCriteria } from './criteria';
import {
  SESSION_COOKIE,
  USERNAME_RE,
  MIN_PASSWORD,
  createSession,
  createUser,
  deleteSession,
  findUser,
  sameText,
  setPassword,
  setUserCriteria,
  setUserDocument,
  userForSession,
  verifyPassword,
  type User,
} from './auth';

type App = { Bindings: Env; Variables: { user: User } };
const app = new Hono<App>();

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function startSession(c: Context<App>, userId: number) {
  const { token, maxAge } = await createSession(c.env.DB, userId);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge });
}

// --- Accounts (no session needed) ---

app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (!username || !password) return c.json({ error: 'Enter a username and password' }, 400);
  const user = await findUser(c.env.DB, username);

  let ok = false;
  if (user?.pass_hash) {
    ok = await verifyPassword(password, user.pass_hash);
  } else if (user && c.env.ACCESS_PASSWORD) {
    // The original account has no password row yet: accept the old shared password once and store it.
    ok = sameText(password, c.env.ACCESS_PASSWORD);
    if (ok) await setPassword(c.env.DB, user.id, password);
  }
  if (!user || !ok) return c.json({ error: 'Wrong username or password' }, 401);

  await startSession(c, user.id);
  return c.json({ username: user.username });
});

app.post('/api/auth/signup', async (c) => {
  const { username, password, invite } = await c.req.json<{ username?: string; password?: string; invite?: string }>();
  if (!c.env.INVITE_CODE) return c.json({ error: 'Sign-up is closed' }, 403);
  if (!invite || !sameText(invite.trim(), c.env.INVITE_CODE)) return c.json({ error: 'That invite code is not valid' }, 403);
  if (!username || !USERNAME_RE.test(username.trim())) {
    return c.json({ error: 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores' }, 400);
  }
  if (!password || password.length < MIN_PASSWORD) {
    return c.json({ error: `Passwords need at least ${MIN_PASSWORD} characters` }, 400);
  }
  if (await findUser(c.env.DB, username)) return c.json({ error: 'That username is taken' }, 409);

  const id = await createUser(c.env.DB, username, password);
  await startSession(c, id);
  return c.json({ username: username.trim() });
});

app.post('/api/auth/logout', async (c) => {
  await deleteSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// Every other API route needs a signed-in account. The page itself is public
// so the sign-in screen can load; it holds no data.
app.use('/api/*', async (c, next) => {
  const user = await userForSession(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: 'Sign in first' }, 401);
  c.set('user', user);
  await next();
});

app.get('/api/auth/me', (c) => {
  const user = c.get('user');
  return c.json({
    username: user.username,
    hasDocument: !!getDocumentSource(user),
    hasCriteria: !!savedCriteria(user),
  });
});

app.put('/api/auth/password', async (c) => {
  const user = c.get('user');
  const { current, next } = await c.req.json<{ current?: string; next?: string }>();
  if (!current || !user.pass_hash || !(await verifyPassword(current, user.pass_hash))) {
    return c.json({ error: 'Current password is wrong' }, 403);
  }
  if (!next || next.length < MIN_PASSWORD) return c.json({ error: `Passwords need at least ${MIN_PASSWORD} characters` }, 400);
  await setPassword(c.env.DB, user.id, next);
  return c.json({ ok: true });
});

// --- Profile: the account's document and criteria ---

app.get('/api/profile', (c) => {
  const user = c.get('user');
  return c.json({
    username: user.username,
    document: user.document_json ? JSON.parse(user.document_json) : null,
    criteria: savedCriteria(user) ?? null,
  });
});

app.put('/api/profile/document', async (c) => {
  try {
    const doc = cleanDocument(await c.req.json());
    await setUserDocument(c.env.DB, c.get('user').id, doc);
    return c.json(doc);
  } catch (err) {
    return c.json({ error: errorText(err) }, 400);
  }
});

app.put('/api/profile/criteria', async (c) => {
  try {
    const criteria = cleanCriteria(await c.req.json());
    await setUserCriteria(c.env.DB, c.get('user').id, criteria);
    return c.json(criteria);
  } catch (err) {
    return c.json({ error: errorText(err) }, 400);
  }
});

// Reads an uploaded PDF into document fields and suggested criteria. Nothing is saved here.
app.post('/api/profile/import', async (c) => {
  const { data } = await c.req.json<{ data?: string }>();
  if (!data || !data.startsWith('JVBER')) return c.json({ error: 'Upload a PDF file' }, 400);
  if ((data.length * 3) / 4 > MAX_PDF_BYTES) return c.json({ error: 'That PDF is over 5 MB' }, 400);
  try {
    return c.json(await importProfilePdf(c.env, data));
  } catch (err) {
    return c.json({ error: errorText(err) }, 502);
  }
});

// --- Listings ---

const num = (v: string | undefined) => (v && !isNaN(Number(v)) ? Number(v) : undefined);

app.get('/api/listings', async (c) => {
  const user = c.get('user');
  const q = (k: string) => c.req.query(k) || undefined;
  // Catch up rows stored before derived columns existed, and re-score
  // anything computed with older criteria. Both are no-ops once done.
  await backfillDerived(c.env.DB);
  await rescoreListings(c.env.DB, user.id, getCriteria(user));
  const rows = await getListings(c.env.DB, user.id, {
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
    englishOnly: q('englishOnly') === '1',
    hideClosed: q('hideClosed') === '1',
    payListed: q('payListed') === '1',
    includeDuplicates: q('includeDuplicates') === '1',
    tier: q('tier'),
  });
  return c.json(rows);
});

// On-demand keyword search across every configured source. Posting age,
// location and remote are passed to each source; the applicant cap and word
// filters are applied when listing results.
app.post('/api/search', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<SearchParams>();
  if (!body.keywords?.trim()) return c.json({ error: 'keywords required' }, 400);

  const startedAt = new Date().toISOString();
  const criteria = getCriteria(user);
  const result = await searchSources(
    c.env,
    { ...body, keywords: body.keywords.trim(), titles: undefined },
    { disabled: criteria.disabledSources, boards: criteria.boards }
  );
  for (const l of result.listings) {
    await upsertListing(c.env.DB, user.id, l, criteria);
  }
  await backfillDerived(c.env.DB);
  await markDuplicates(c.env.DB, user.id);
  await closeMissingBoardPostings(c.env.DB, user.id, result.boardResults);
  await recordSyncRun(c.env.DB, user.id, startedAt, new Date().toISOString(), result.ok, result.failed, result.listings.length);

  const summary = { processed: result.listings.length, counts: result.counts, errors: result.errors };
  return c.json(summary, result.ok.length === 0 ? 502 : 200);
});

app.post('/api/listings/:id/contact', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await getListing(c.env.DB, user.id, id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const result = await findPosterEmail(c.env, row as any);
  // Don't persist transient errors (bad key, rate limit) so a retry is possible.
  if (result.status !== 'error') {
    await setContact(c.env.DB, user.id, id, result.email, result.status, result.score ?? null);
  }
  return c.json(result, result.status === 'error' ? 502 : 200);
});

app.post('/api/listings/:id/draft', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await getListing(c.env.DB, user.id, id);
  if (!row) return c.json({ error: 'not found' }, 404);

  const profile = savedCriteria(user)?.outreach;
  if (!profile?.name || !profile.background?.length) {
    return c.json({ error: 'Add your name and background notes on the Profile page first' }, 400);
  }
  try {
    const draft = await draftOutreach(c.env, profile, row as any);
    await setDraft(c.env.DB, user.id, id, draft.subject, draft.body);
    return c.json(draft);
  } catch (err) {
    return c.json({ error: errorText(err) }, 502);
  }
});

// Save manual edits to a draft.
app.put('/api/listings/:id/draft', async (c) => {
  const body = await c.req.json<{ subject: string; body: string }>();
  await setDraft(c.env.DB, c.get('user').id, c.req.param('id'), body.subject ?? '', body.body ?? '');
  return c.json({ ok: true });
});

app.post('/api/listings/:id/status', async (c) => {
  const body = await c.req.json<{ status: string }>();
  await setListingStatus(c.env.DB, c.get('user').id, c.req.param('id'), body.status);
  return c.json({ ok: true });
});

app.get('/api/stats', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT status, COUNT(*) as count FROM listings WHERE user_id = ? GROUP BY status')
    .bind(c.get('user').id)
    .all();
  return c.json(results);
});

// Every source with whether it's set up, for the Profile page.
app.get('/api/sources', (c) => c.json(sourceCatalog(c.env)));

app.get('/api/digest', async (c) => {
  const user = c.get('user');
  await rescoreListings(c.env.DB, user.id, getCriteria(user));
  const days = Math.min(Math.max(num(c.req.query('days')) ?? 7, 1), 30);
  return c.json(await getDigest(c.env.DB, user.id, days));
});

// Opens one posting to see whether it's still up.
app.post('/api/listings/:id/check', async (c) => {
  const user = c.get('user');
  const row = await getListing(c.env.DB, user.id, c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  const status = await checkPosting(row.url, row.source);
  await setOpenStatus(c.env.DB, user.id, row.id, status);
  return c.json({ open_status: status ?? row.open_status ?? null, checked: status !== null });
});

app.post('/api/sync', async (c) => {
  const user = c.get('user');
  if (!savedCriteria(user)) return c.json({ error: 'Save your criteria on the Profile page first' }, 400);
  return c.json(await syncUser(c.env, user.id, getCriteria(user)));
});

// --- Personalization: a title and description entered by hand ---

app.get('/api/personalize', async (c) => c.json(await listPersonalizations(c.env.DB, c.get('user').id)));

app.post('/api/personalize', async (c) => {
  const { title, company, description } = await c.req.json<{ title?: string; company?: string; description?: string }>();
  if (!title?.trim() || !description?.trim()) return c.json({ error: 'Enter a title and a description' }, 400);
  const id = await createPersonalization(c.env.DB, c.get('user').id, {
    title: title.trim().slice(0, 200),
    company: company?.trim().slice(0, 200) || null,
    description: description.trim().slice(0, 30000),
  });
  return c.json({ id });
});

app.get('/api/personalize/:id', async (c) => {
  const row = await getPersonalization(c.env.DB, c.get('user').id, Number(c.req.param('id')));
  if (!row) return c.json({ error: 'not found' }, 404);
  const { tailored_doc, ...rest } = row;
  return c.json({ ...rest, document: tailored_doc ? JSON.parse(tailored_doc) : null });
});

app.delete('/api/personalize/:id', async (c) => {
  await deletePersonalization(c.env.DB, c.get('user').id, Number(c.req.param('id')));
  return c.json({ ok: true });
});

// --- Tailored document and letter, for a listing or a personalization ---

interface Target {
  title: string;
  company: string | null;
  description: string | null;
  poster_name?: string | null;
  tailored_doc: string | null;
  letter_body: string | null;
}

const NO_DOCUMENT = 'Add your profile document on the Profile page first';

function letterHeader(source: ProfileDocument) {
  return { name: source.name, contact: source.contact, fileName: source.letterFileName || `${source.name} Letter.pdf` };
}

function outputRoutes(prefix: string, table: OutputTable, load: (db: D1Database, userId: number, id: string) => Promise<Target | null>) {
  const key = (id: string) => (table === 'personalizations' ? Number(id) : id);

  // Tailored PDF content. Returns the saved one unless ?redo=1.
  app.post(`${prefix}/:id/document`, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await load(c.env.DB, user.id, id);
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.tailored_doc && c.req.query('redo') !== '1') return c.json(JSON.parse(row.tailored_doc));

    const source = getDocumentSource(user);
    if (!source) return c.json({ error: NO_DOCUMENT }, 400);
    try {
      const doc = await tailorDocument(c.env, source, row);
      await setTailoredDocument(c.env.DB, table, user.id, key(id), JSON.stringify(doc));
      return c.json(doc);
    } catch (err) {
      return c.json({ error: errorText(err) }, 502);
    }
  });

  // Letter with the header details the PDF needs. Returns the saved one unless ?redo=1.
  app.post(`${prefix}/:id/letter`, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    const row = await load(c.env.DB, user.id, id);
    if (!row) return c.json({ error: 'not found' }, 404);
    const source = getDocumentSource(user);
    if (!source) return c.json({ error: NO_DOCUMENT }, 400);
    const header = letterHeader(source);
    if (row.letter_body && c.req.query('redo') !== '1') return c.json({ ...header, body: row.letter_body });

    try {
      const body = await writeLetter(c.env, source, savedCriteria(user)?.outreach, { poster_name: null, ...row });
      await setLetter(c.env.DB, table, user.id, key(id), body);
      return c.json({ ...header, body });
    } catch (err) {
      return c.json({ error: errorText(err) }, 502);
    }
  });

  // Save manual edits to a letter.
  app.put(`${prefix}/:id/letter`, async (c) => {
    const body = await c.req.json<{ body: string }>();
    await setLetter(c.env.DB, table, c.get('user').id, key(c.req.param('id')), body.body ?? '');
    return c.json({ ok: true });
  });
}

outputRoutes('/api/listings', 'listings', (db, userId, id) => getListing(db, userId, id) as Promise<Target | null>);
outputRoutes('/api/personalize', 'personalizations', (db, userId, id) => getPersonalization(db, userId, Number(id)));

// Anything else falls through to the built frontend.
app.get('*', async (c) => await c.env.ASSETS.fetch(c.req.raw));

async function syncUser(env: Env, userId: number, criteria: ReturnType<typeof getCriteria>) {
  const startedAt = new Date().toISOString();
  const { listings, ok, failed, errors, boardResults } = await fetchAllSources(env, criteria);
  for (const listing of listings) {
    await upsertListing(env.DB, userId, listing, criteria);
  }
  await backfillDerived(env.DB);
  await rescoreListings(env.DB, userId, criteria);
  await markDuplicates(env.DB, userId);
  await closeMissingBoardPostings(env.DB, userId, boardResults);
  await closeExpired(env.DB, userId);
  const checked = await checkSome(env.DB, userId);
  await recordSyncRun(env.DB, userId, startedAt, new Date().toISOString(), ok, failed, listings.length);
  await markSynced(env.DB, userId);
  return { ok, failed, errors, processed: listings.length, checked };
}

/**
 * Scheduled sync, run hourly: the one account most overdue (synced more than
 * 4 hours ago). One account per run keeps each run under the outbound
 * request limit.
 */
async function syncDue(env: Env) {
  const u = await nextAccountToSync(env.DB);
  if (u) {
    try {
      await syncUser(env, u.id, getCriteria(u));
    } catch (err) {
      console.error(`sync for account ${u.id} failed:`, err);
    }
  }
  const pruned = await pruneStale(env.DB, 30);
  if (pruned) console.log(`pruned ${pruned} stale listings`);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncDue(env));
  },
};
