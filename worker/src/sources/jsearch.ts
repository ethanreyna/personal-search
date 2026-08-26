import type { Env, Criteria, RawListing } from './types';

export async function fetchJSearch(env: Env, criteria: Criteria): Promise<RawListing[]> {
  if (!env.RAPIDAPI_KEY) return [];

  const query = `${criteria.titles[0]} in Houston, TX or remote`;
  const url = `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(query)}&num_pages=1&date_posted=week`;

  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  });
  if (!res.ok) return [];
  const data: any = await res.json();

  return (data.data ?? []).map((r: any) => ({
    source: 'jsearch',
    externalId: String(r.job_id),
    title: r.job_title,
    company: r.employer_name,
    location: [r.job_city, r.job_state].filter(Boolean).join(', ') || (r.job_is_remote ? 'Remote' : ''),
    remote: !!r.job_is_remote,
    url: r.job_apply_link || r.job_google_link || '',
    description: r.job_description,
    salaryMin: r.job_min_salary ?? undefined,
    salaryMax: r.job_max_salary ?? undefined,
    postedAt: r.job_posted_at_datetime_utc,
  })) as RawListing[];
}
