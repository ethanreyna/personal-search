import type { Env, RawListing, SearchParams } from './types';
import { shortLocation, withinDays } from './query';
import { parseSalary } from '../signals';

// Free keys allow 100 requests a day (US listings for a jooble.org key), so this makes one request per search.
export async function fetchJooble(env: Env, p: SearchParams): Promise<RawListing[]> {
  if (!env.JOOBLE_API_KEY) return [];
  const location = p.remoteOnly ? 'Remote' : shortLocation(p.location) ?? 'United States';
  const res = await fetch(`https://jooble.org/api/${encodeURIComponent(env.JOOBLE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: p.remoteOnly ? `${p.keywords} remote` : p.keywords,
      location,
      page: 1,
      ResultOnPage: Math.min(Math.max(p.limit ?? 50, 10), 100),
    }),
  });
  if (res.status === 429) throw new Error('jooble daily limit reached');
  if (!res.ok) throw new Error(`jooble ${res.status}`);
  const data: any = await res.json();
  return ((data.jobs ?? []) as any[])
    .filter((r) => withinDays(r.updated, p.postedWithinDays))
    .map((r) => {
      const pay = parseSalary(r.salary);
      return {
        source: 'jooble',
        externalId: String(r.id),
        title: r.title,
        company: r.company || undefined,
        location: r.location || undefined,
        remote: /remote/i.test(`${r.title} ${r.location} ${r.type ?? ''}`),
        url: r.link,
        description: r.snippet,
        salaryMin: pay?.min,
        salaryMax: pay?.max,
        postedAt: r.updated ? new Date(r.updated).toISOString() : undefined,
      };
    });
}
