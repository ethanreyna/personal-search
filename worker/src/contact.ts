import type { Env } from './sources/types';

export interface ContactLookup {
  email: string | null;
  status: 'found' | 'not_found' | 'no_poster' | 'error';
  /** Hunter's 0-100 confidence score. */
  score?: number;
  detail?: string;
}

function domainFrom(website: string | null | undefined): string | undefined {
  if (!website) return undefined;
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * Looks up a work email for the person who posted a listing via Hunter's
 * email-finder. It tries the profile URL first and falls back to name +
 * company domain. Hunter only spends a credit when it returns an address,
 * and this only runs when requested from the dashboard.
 */
export async function findPosterEmail(
  env: Env,
  row: { poster_url: string | null; poster_name: string | null; company: string | null; company_website: string | null }
): Promise<ContactLookup> {
  if (!env.HUNTER_API_KEY) return { email: null, status: 'error', detail: 'HUNTER_API_KEY is not set' };
  if (!row.poster_url && !row.poster_name) return { email: null, status: 'no_poster' };

  const qs = new URLSearchParams({ api_key: env.HUNTER_API_KEY, max_duration: '15' });
  if (row.poster_url) qs.set('linkedin_handle', row.poster_url);
  if (row.poster_name) {
    const parts = row.poster_name.trim().split(/\s+/);
    if (parts.length > 1) {
      qs.set('first_name', parts[0]);
      qs.set('last_name', parts[parts.length - 1]);
    } else {
      qs.set('full_name', row.poster_name.trim());
    }
  }
  const domain = domainFrom(row.company_website);
  if (domain) qs.set('domain', domain);
  else if (row.company) qs.set('company', row.company);

  const res = await fetch(`https://api.hunter.io/v2/email-finder?${qs.toString()}`);
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.errors?.[0];
    // 451: the person asked Hunter not to process their data. 404: no match.
    if (res.status === 451) return { email: null, status: 'not_found', detail: 'person opted out of lookups' };
    if (res.status === 404) return { email: null, status: 'not_found', detail: 'no match' };
    // A bad name/domain/handle won't succeed on retry, so record it as not found.
    if (res.status === 400 && err?.id && err.id !== 'wrong_params') {
      return { email: null, status: 'not_found', detail: err.details ?? err.id };
    }
    return { email: null, status: 'error', detail: `Hunter ${res.status}: ${err?.details ?? 'request failed'}` };
  }

  const email: string | undefined = data?.data?.email;
  if (!email) return { email: null, status: 'not_found', detail: 'no match' };
  const status = data?.data?.verification?.status;
  return {
    email,
    status: 'found',
    score: typeof data.data.score === 'number' ? data.data.score : undefined,
    detail: status ? `verification: ${status}` : undefined,
  };
}
