import type { Env, Criteria, RawListing } from './types';
import { fetchAdzuna } from './adzuna';
import { fetchJSearch } from './jsearch';
import { fetchRemotive } from './remotive';
import { fetchRemoteOk } from './remoteok';
import { fetchArbeitnow } from './arbeitnow';

export async function fetchAllSources(env: Env, criteria: Criteria) {
  const jobs: Array<{ name: string; run: () => Promise<RawListing[]> }> = [
    { name: 'adzuna', run: () => fetchAdzuna(env, criteria) },
    { name: 'jsearch', run: () => fetchJSearch(env, criteria) },
    { name: 'remotive', run: () => fetchRemotive(criteria) },
    { name: 'remoteok', run: () => fetchRemoteOk() },
    { name: 'arbeitnow', run: () => fetchArbeitnow() },
  ];

  const ok: string[] = [];
  const failed: string[] = [];
  let all: RawListing[] = [];

  for (const job of jobs) {
    try {
      const results = await job.run();
      all = all.concat(results);
      ok.push(job.name);
    } catch (err) {
      console.error(`source ${job.name} failed:`, err);
      failed.push(job.name);
    }
  }

  return { listings: all, ok, failed };
}
