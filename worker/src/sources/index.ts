import type { Env, Criteria, RawListing, SearchParams } from './types';
import { fetchAdzuna } from './adzuna';
import { fetchJSearch } from './jsearch';
import { fetchRemotive } from './remotive';
import { fetchRemoteOk } from './remoteok';
import { fetchArbeitnow } from './arbeitnow';
import { fetchJooble } from './jooble';
import { fetchFederal } from './federal';
import { searchLinkedIn } from './linkedin';
import { fetchBoards, parseBoards, type BoardResult } from './boards';
import { paramsFromCriteria } from './query';

/** Every source, for the Profile page's on/off switches. `configured` is false when its key isn't set. */
export function sourceCatalog(env: Env): Array<{ name: string; label: string; configured: boolean; note?: string }> {
  return [
    { name: 'linkedin', label: 'LinkedIn', configured: !!env.APIFY_TOKEN, note: 'On-demand search only' },
    { name: 'adzuna', label: 'Adzuna', configured: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) },
    { name: 'jsearch', label: 'JSearch', configured: !!env.RAPIDAPI_KEY },
    { name: 'jooble', label: 'Jooble', configured: !!env.JOOBLE_API_KEY, note: '100 requests a day' },
    { name: 'federal', label: 'Federal', configured: !!(env.FEDERAL_API_KEY && env.FEDERAL_API_EMAIL) },
    { name: 'boards', label: 'Employer boards', configured: true, note: 'Greenhouse, Lever and Ashby boards you list' },
    { name: 'remotive', label: 'Remotive', configured: true },
    { name: 'remoteok', label: 'RemoteOK', configured: true },
    { name: 'arbeitnow', label: 'Arbeitnow', configured: true },
  ];
}

interface SourceRun {
  name: string;
  enabled: boolean;
  run: () => Promise<RawListing[]>;
}

export interface SearchOptions {
  includeLinkedIn?: boolean;
  /** Sources turned off for the account. */
  disabled?: string[];
  /** Employer boards to read, as "kind:name". */
  boards?: string[];
}

export interface SearchOutcome {
  listings: RawListing[];
  ok: string[];
  failed: string[];
  counts: Record<string, number>;
  errors: Record<string, string>;
  /** Boards read successfully, with every posting id on them. */
  boardResults: BoardResult[];
}

/** Runs every enabled source in parallel with the same search. */
export async function searchSources(env: Env, p: SearchParams, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const off = new Set(opts.disabled ?? []);
  const boards = parseBoards(opts.boards);
  const out: SearchOutcome = { listings: [], ok: [], failed: [], counts: {}, errors: {}, boardResults: [] };

  const runs: SourceRun[] = [
    { name: 'linkedin', enabled: (opts.includeLinkedIn ?? true) && !!env.APIFY_TOKEN, run: () => searchLinkedIn(env, p) },
    { name: 'adzuna', enabled: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY), run: () => fetchAdzuna(env, p) },
    { name: 'jsearch', enabled: !!env.RAPIDAPI_KEY, run: () => fetchJSearch(env, p) },
    { name: 'jooble', enabled: !!env.JOOBLE_API_KEY, run: () => fetchJooble(env, p) },
    { name: 'federal', enabled: !!(env.FEDERAL_API_KEY && env.FEDERAL_API_EMAIL), run: () => fetchFederal(env, p) },
    { name: 'remotive', enabled: true, run: () => fetchRemotive(p) },
    { name: 'remoteok', enabled: true, run: () => fetchRemoteOk(p) },
    { name: 'arbeitnow', enabled: true, run: () => fetchArbeitnow(p) },
    {
      name: 'boards',
      enabled: boards.length > 0,
      run: async () => {
        const r = await fetchBoards(boards, p);
        out.boardResults = r.results;
        if (r.errors.length) out.errors.boards = r.errors.join('; ');
        if (!r.results.length) throw new Error(r.errors.join('; ') || 'no boards could be read');
        return r.results.flatMap((b) => b.listings);
      },
    },
  ].filter((s) => s.enabled && !off.has(s.name));

  const settled = await Promise.allSettled(runs.map((s) => s.run()));
  settled.forEach((r, i) => {
    const name = runs[i].name;
    if (r.status === 'fulfilled') {
      out.listings.push(...r.value);
      out.ok.push(name);
      out.counts[name] = r.value.length;
    } else {
      console.error(`source ${name} failed:`, r.reason);
      out.failed.push(name);
      out.errors[name] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  });
  return out;
}

/** Scheduled sync: everything but LinkedIn, with a search built from the criteria. */
export async function fetchAllSources(env: Env, criteria: Criteria) {
  return searchSources(
    env,
    { ...paramsFromCriteria(criteria), titles: criteria.titles },
    { includeLinkedIn: false, disabled: criteria.disabledSources, boards: criteria.boards }
  );
}
