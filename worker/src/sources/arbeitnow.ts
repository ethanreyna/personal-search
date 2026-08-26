import type { RawListing } from './types';

export async function fetchArbeitnow(): Promise<RawListing[]> {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) return [];
  const data: any = await res.json();

  return ((data.data ?? []) as any[]).map((r: any) => ({
    source: 'arbeitnow',
    externalId: r.slug,
    title: r.title,
    company: r.company_name,
    location: r.location || (r.remote ? 'Remote' : ''),
    remote: !!r.remote,
    url: r.url,
    description: r.description,
    postedAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : undefined,
  })) as RawListing[];
}
