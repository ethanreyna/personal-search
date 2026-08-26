import type { Env, Criteria, RawListing } from './types';

export async function fetchAdzuna(env: Env, criteria: Criteria): Promise<RawListing[]> {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return [];

  const what = criteria.titles.slice(0, 3).join(' ');
  const searches = [{ where: 'Houston TX' }, { where: '' }];
  const out: RawListing[] = [];

  for (const s of searches) {
    const params = new URLSearchParams();
    params.set('app_id', env.ADZUNA_APP_ID);
    params.set('app_key', env.ADZUNA_APP_KEY);
    params.set('results_per_page', '30');
    params.set('what', what);
    params.set('content-type', 'application/json');
    if (s.where) params.set('where', s.where);

    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`);
    if (!res.ok) continue;
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
