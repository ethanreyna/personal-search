import type { Env, RawListing, SearchParams } from './types';
import { shortLocation } from './query';

export async function fetchAdzuna(env: Env, p: SearchParams): Promise<RawListing[]> {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return [];
  const where = shortLocation(p.location);
  // A location search plus a remote search, unless only remote was asked for.
  const searches: Array<{ what: string; where?: string }> = [];
  if (where && !p.remoteOnly) searches.push({ what: p.keywords, where });
  searches.push({ what: `${p.keywords} remote` });

  const perPage = Math.min(Math.max(p.limit ?? 30, 10), 50);
  const out: RawListing[] = [];
  for (const s of searches) {
    const params = new URLSearchParams();
    params.set('app_id', env.ADZUNA_APP_ID);
    params.set('app_key', env.ADZUNA_APP_KEY);
    params.set('results_per_page', String(perPage));
    params.set('what', s.what);
    params.set('sort_by', 'date');
    params.set('content-type', 'application/json');
    if (s.where) params.set('where', s.where);
    if (p.postedWithinDays) params.set('max_days_old', String(p.postedWithinDays));

    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`);
    if (!res.ok) throw new Error(`adzuna ${res.status}`);
    const data: any = await res.json();
    for (const r of data.results ?? []) {
      out.push({
        source: 'adzuna',
        externalId: String(r.id),
        title: r.title,
        company: r.company?.display_name,
        location: r.location?.display_name,
        remote: /remote/i.test(`${r.title} ${r.description ?? ''}`),
        url: r.redirect_url,
        description: r.description,
        salaryMin: r.salary_min,
        salaryMax: r.salary_max,
        postedAt: r.created,
      });
    }
  }
  return out;
}
