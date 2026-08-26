import type { Criteria, RawListing } from './types';

export async function fetchRemotive(criteria: Criteria): Promise<RawListing[]> {
  const search = encodeURIComponent(criteria.titles[0] ?? 'software engineer');
  const res = await fetch(`https://remotive.com/api/remote-jobs?search=${search}`);
  if (!res.ok) return [];
  const data: any = await res.json();

  return ((data.jobs ?? []) as any[]).slice(0, 50).map((r: any) => ({
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
