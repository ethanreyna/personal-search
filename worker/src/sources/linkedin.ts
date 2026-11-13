import type { Env, RawListing, SearchParams } from './types';

const DEFAULT_ACTOR = 'curious_coder~linkedin-jobs-scraper';

/**
 * Builds a public search URL. `f_TPR=r<seconds>` limits by posting age,
 * `f_WT=2` limits to remote, `sortBy=DD` sorts newest first.
 */
export function buildSearchUrl(p: SearchParams): string {
  const qs = new URLSearchParams();
  qs.set('keywords', p.keywords);
  if (p.location) qs.set('location', p.location);
  if (p.postedWithinDays && p.postedWithinDays > 0) {
    qs.set('f_TPR', `r${Math.round(p.postedWithinDays * 86400)}`);
  }
  if (p.remoteOnly) qs.set('f_WT', '2');
  qs.set('sortBy', 'DD');
  return `https://www.linkedin.com/jobs/search/?${qs.toString()}`;
}

/** "200", "Over 200 applicants", 37 -> number; anything else -> undefined. */
function parseApplicants(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/\d+/);
    if (m) return Number(m[0]);
  }
  return undefined;
}

function toIso(r: any): string | undefined {
  if (r.postedAtTimestamp) {
    const d = new Date(Number(r.postedAtTimestamp));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (r.postedAt) {
    const d = new Date(r.postedAt);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

/**
 * Runs the hosted scraper synchronously and returns normalized listings.
 * This can take a minute or two; the Apify sync endpoint waits up to 300s.
 */
export async function searchLinkedIn(env: Env, p: SearchParams): Promise<RawListing[]> {
  if (!env.APIFY_TOKEN) throw new Error('APIFY_TOKEN is not set');

  const actor = env.APIFY_ACTOR || DEFAULT_ACTOR;
  const limit = Math.min(Math.max(p.limit ?? 50, 10), 200);
  const searchUrl = buildSearchUrl(p);

  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=280&clean=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.APIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls: [searchUrl],
        scrapeCompany: true,
        limitPerSource: limit,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apify request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const items: any[] = await res.json();
  return items
    .filter((r) => r && r.id && r.title)
    .map((r) => {
      const location: string = r.location ?? '';
      return {
        source: 'linkedin',
        externalId: String(r.id),
        title: r.title,
        company: r.companyName ?? undefined,
        location,
        remote: !!p.remoteOnly || /remote/i.test(location) || /remote/i.test(r.workplaceType ?? ''),
        url: r.link || `https://www.linkedin.com/jobs/view/${r.id}`,
        description: r.descriptionText ?? undefined,
        postedAt: toIso(r),
        applicants: parseApplicants(r.applicantsCount),
        posterName: r.jobPosterName || undefined,
        posterTitle: r.jobPosterTitle || undefined,
        posterUrl: r.jobPosterProfileUrl || undefined,
        companyWebsite: r.companyWebsite || undefined,
      } satisfies RawListing;
    });
}
