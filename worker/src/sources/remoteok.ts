import type { RawListing, SearchParams } from './types';
import { keywordTokens, matchesKeywords, withinDays } from './query';

// The feed has no search, so it's fetched whole and matched on keywords here.
export async function fetchRemoteOk(p: SearchParams): Promise<RawListing[]> {
  const tokens = keywordTokens(p.keywords);
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'personal-search-app (contact form on site)' },
  });
  if (!res.ok) throw new Error(`remoteok ${res.status}`);
  const data: any = await res.json();
  const rows: any[] = Array.isArray(data) ? data.slice(1) : []; // first entry is a legal notice
  return rows
    .filter((r) => r.id && r.position)
    .filter((r) => withinDays(r.date, p.postedWithinDays))
    .filter((r) => matchesKeywords(`${r.position} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`, tokens))
    .slice(0, p.limit ?? 50)
    .map((r: any) => ({
      source: 'remoteok',
      externalId: String(r.id),
      title: r.position,
      company: r.company,
      location: r.location || 'Remote',
      remote: true,
      url: r.url,
      description: r.description,
      salaryMin: r.salary_min || undefined,
      salaryMax: r.salary_max || undefined,
      postedAt: r.date,
    })) as RawListing[];
}
