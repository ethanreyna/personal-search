import type { RawListing, SearchParams } from './types';
import { keywordTokens, matchesKeywords, withinDays } from './query';

// Mostly European listings, so only remote ones are kept. No search on the
// API side; results are matched on keywords here.
export async function fetchArbeitnow(p: SearchParams): Promise<RawListing[]> {
  const tokens = keywordTokens(p.keywords);
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) throw new Error(`arbeitnow ${res.status}`);
  const data: any = await res.json();
  return ((data.data ?? []) as any[])
    .filter((r) => r.remote)
    .map((r) => ({ ...r, postedIso: r.created_at ? new Date(r.created_at * 1000).toISOString() : undefined }))
    .filter((r) => withinDays(r.postedIso, p.postedWithinDays))
    .filter((r) => matchesKeywords(`${r.title} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`, tokens))
    .slice(0, p.limit ?? 50)
    .map((r: any) => ({
      source: 'arbeitnow',
      externalId: r.slug,
      title: r.title,
      company: r.company_name,
      location: r.location || 'Remote',
      remote: true,
      url: r.url,
      description: r.description,
      postedAt: r.postedIso,
    })) as RawListing[];
}
