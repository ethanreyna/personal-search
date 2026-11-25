import type { Env, RawListing, SearchParams } from './types';
import { shortLocation } from './query';

// Federal listings API. It requires the registered email address as the User-Agent.
export async function fetchFederal(env: Env, p: SearchParams): Promise<RawListing[]> {
  if (!env.FEDERAL_API_KEY || !env.FEDERAL_API_EMAIL) return [];
  const params = new URLSearchParams({
    Keyword: p.keywords,
    ResultsPerPage: String(Math.min(Math.max(p.limit ?? 50, 10), 250)),
    SortField: 'opendate',
    SortDirection: 'desc',
  });
  if (p.postedWithinDays) params.set('DatePosted', String(Math.min(p.postedWithinDays, 60)));
  const where = shortLocation(p.location);
  if (p.remoteOnly) params.set('RemoteIndicator', 'True');
  else if (where) {
    params.set('LocationName', where);
    params.set('Radius', '50');
  }

  const res = await fetch(`https://data.usajobs.gov/api/Search?${params}`, {
    headers: {
      Host: 'data.usajobs.gov',
      'User-Agent': env.FEDERAL_API_EMAIL,
      'Authorization-Key': env.FEDERAL_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`federal ${res.status}`);
  const data: any = await res.json();
  return ((data.SearchResult?.SearchResultItems ?? []) as any[]).map((item) => {
    const d = item.MatchedObjectDescriptor ?? {};
    const details = d.UserArea?.Details ?? {};
    const pay = (d.PositionRemuneration ?? [])[0];
    const perYear = (v: unknown) => {
      const n = Number(v);
      if (!n) return undefined;
      return pay?.RateIntervalCode === 'PH' ? Math.round(n * 2080) : n;
    };
    const duties = Array.isArray(details.MajorDuties) ? details.MajorDuties.join('\n') : details.MajorDuties;
    const location = d.PositionLocationDisplay as string | undefined;
    return {
      source: 'federal',
      externalId: String(item.MatchedObjectId ?? d.PositionID),
      title: d.PositionTitle,
      company: [d.OrganizationName, d.DepartmentName].filter(Boolean).join(', ') || undefined,
      location,
      remote: /remote|anywhere in the u/i.test(location ?? ''),
      url: d.PositionURI,
      description: [details.JobSummary, duties, d.QualificationSummary, details.Requirements, details.Education]
        .filter(Boolean)
        .join('\n\n'),
      salaryMin: perYear(pay?.MinimumRange),
      salaryMax: perYear(pay?.MaximumRange),
      postedAt: d.PublicationStartDate ? new Date(d.PublicationStartDate).toISOString() : undefined,
      closesAt: d.ApplicationCloseDate ? new Date(d.ApplicationCloseDate).toISOString() : undefined,
      openNow: true,
    };
  });
}
