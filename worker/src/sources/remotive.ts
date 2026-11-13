import type { RawListing, SearchParams } from './types';
import { keywordTokens, matchesKeywords, withinDays } from './query';

// Everything here is remote. The API's search is a loose match, so results
// are also checked against the keywords.
export async function fetchRemotive(p: SearchParams): Promise<RawListing[]> {
  const tokens = keywordTokens(p.keywords);
  const res = await fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(p.keywords)}`);
  if (!res.ok) throw new Error(`remotive ${res.status}`);
  const data: any = await res.json();
  return ((data.jobs ?? []) as any[])
    .filter((r) => withinDays(r.publication_date, p.postedWithinDays))
    .filter((r) => matchesKeywords(`${r.title} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`, tokens))
    .slice(0, p.limit ?? 50)
    .map((r: any) => ({
      source: 'remotive',
      externalId: String(r.id),
      title: r.title,
      company: r.company_name,
      location: r.candidate_required_location || 'Remote',
      remote: true,
      url: r.url,
      description: r.description,
      postedAt: r.publication_date,
    })) as RawListing[];
}
