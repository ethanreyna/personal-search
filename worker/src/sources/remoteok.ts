import type { RawListing } from './types';

export async function fetchRemoteOk(): Promise<RawListing[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'personal-search-app (contact form on site)' },
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  const rows: any[] = Array.isArray(data) ? data.slice(1) : []; // first entry is a legal notice, not a job

  return rows
    .filter((r) => r.id && r.position)
    .map((r: any) => ({
      source: 'remoteok',
      externalId: String(r.id),
      title: r.position,
      company: r.company,
      location: r.location || 'Remote',
      remote: true,
      url: r.url,
      description: r.description,
      salaryMin: r.salary_min ?? undefined,
      salaryMax: r.salary_max ?? undefined,
      postedAt: r.date,
    })) as RawListing[];
}
