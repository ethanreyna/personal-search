import type { Env, Criteria, RawListing, SearchParams } from './types';
import { fetchAdzuna } from './adzuna';
import { fetchJSearch } from './jsearch';
import { fetchRemotive } from './remotive';
import { fetchRemoteOk } from './remoteok';
import { fetchArbeitnow } from './arbeitnow';
import { searchLinkedIn } from './linkedin';
import { paramsFromCriteria } from './query';

interface SourceRun {
  name: string;
  /** False when the source needs a key that isn't set. */
  enabled: boolean;
  run: () => Promise<RawListing[]>;
}

function sourcesFor(env: Env, p: SearchParams, includeLinkedIn: boolean): SourceRun[] {
  return [
    { name: 'linkedin', enabled: includeLinkedIn && !!env.APIFY_TOKEN, run: () => searchLinkedIn(env, p) },
    { name: 'adzuna', enabled: !!(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY), run: () => fetchAdzuna(env, p) },
    { name: 'jsearch', enabled: !!env.RAPIDAPI_KEY, run: () => fetchJSearch(env, p) },
    { name: 'remotive', enabled: true, run: () => fetchRemotive(p) },
    { name: 'remoteok', enabled: true, run: () => fetchRemoteOk(p) },
    { name: 'arbeitnow', enabled: true, run: () => fetchArbeitnow(p) },
  ];
}

export interface SearchOutcome {
  listings: RawListing[];
  ok: string[];
  failed: string[];
  counts: Record<string, number>;
  errors: Record<string, string>;
}

/** Runs every enabled source in parallel with the same search. */
export async function searchSources(
  env: Env,
  p: SearchParams,
  opts: { includeLinkedIn?: boolean } = {}
): Promise<SearchOutcome> {
  const runs = sourcesFor(env, p, opts.includeLinkedIn ?? true).filter((s) => s.enabled);
  const settled = await Promise.allSettled(runs.map((s) => s.run()));

  const out: SearchOutcome = { listings: [], ok: [], failed: [], counts: {}, errors: {} };
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

/** Scheduled sync: the non-LinkedIn sources, with a search built from the criteria file. */
export async function fetchAllSources(env: Env, criteria: Criteria) {
  return searchSources(env, paramsFromCriteria(criteria), { includeLinkedIn: false });
}
