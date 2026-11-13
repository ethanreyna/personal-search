import type { Env, RawListing, SearchParams } from './types';
import { shortLocation } from './query';

function datePosted(days?: number): string {
  if (!days) return 'all';
  if (days <= 1) return 'today';
  if (days <= 3) return '3days';
  if (days <= 7) return 'week';
  return 'month';
}

export async function fetchJSearch(env: Env, p: SearchParams): Promise<RawListing[]> {
  if (!env.RAPIDAPI_KEY) return [];
  const where = shortLocation(p.location);
  const query = p.remoteOnly
    ? `${p.keywords} remote`
    : where
      ? `${p.keywords} in ${where} or remote`
      : p.keywords;
  const qs = new URLSearchParams({
    query,
    num_pages: '1',
    country: 'us',
    date_posted: datePosted(p.postedWithinDays),
  });
  if (p.remoteOnly) qs.set('remote_jobs_only', 'true');

  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${qs.toString()}`, {
    headers: {
      'X-RapidAPI-Key': env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  });
  if (!res.ok) throw new Error(`jsearch ${res.status}`);
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
    companyWebsite: r.employer_website || undefined,
  })) as RawListing[];
}
