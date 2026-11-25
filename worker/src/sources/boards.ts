import type { RawListing, SearchParams } from './types';
import { keywordTokens, matchesKeywords, withinDays } from './query';
import { decodeEntities } from '../signals';

// Public employer boards (Greenhouse, Lever, Ashby). Each board lists every
// open posting at that employer, so being in the feed means it's open.

export type BoardKind = 'greenhouse' | 'lever' | 'ashby';
export interface Board {
  kind: BoardKind;
  name: string;
}

/** "greenhouse:stripe" -> { kind, name }. Anything else is ignored. */
export function parseBoards(list: string[] | undefined): Board[] {
  const out: Board[] = [];
  for (const raw of list ?? []) {
    const m = raw.trim().toLowerCase().match(/^(greenhouse|lever|ashby)\s*:\s*([a-z0-9._-]+)$/);
    if (m) out.push({ kind: m[1] as BoardKind, name: m[2] });
  }
  return out.slice(0, 20);
}

export interface BoardResult {
  board: Board;
  /** Every posting id on the board, before filtering (used to spot closed ones). */
  allIds: string[];
  listings: RawListing[];
}

const remoteText = (s: string) => /\bremote\b/i.test(s);

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function readBoard(b: Board): Promise<RawListing[]> {
  const source = b.kind;
  const ext = (id: unknown) => `${b.name}:${id}`;
  if (b.kind === 'greenhouse') {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b.name}/jobs?content=true`);
    return (data.jobs ?? []).map((j: any) => ({
      source,
      externalId: ext(j.id),
      title: j.title,
      company: j.company_name || b.name,
      location: j.location?.name,
      remote: remoteText(`${j.location?.name ?? ''} ${j.title}`),
      url: j.absolute_url,
      description: decodeEntities(j.content ?? ''),
      postedAt: j.first_published ?? j.updated_at,
      openNow: true,
    }));
  }
  if (b.kind === 'lever') {
    const data = await getJson(`https://api.lever.co/v0/postings/${b.name}?mode=json`);
    return (data ?? []).map((j: any) => ({
      source,
      externalId: ext(j.id),
      title: j.text,
      company: b.name,
      location: j.categories?.location,
      remote: j.workplaceType === 'remote' || remoteText(j.categories?.location ?? ''),
      url: j.hostedUrl,
      description: [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${l.content}`), j.additionalPlain]
        .filter(Boolean)
        .join('\n\n'),
      salaryMin: j.salaryRange?.interval === 'per-year-salary' ? j.salaryRange.min : undefined,
      salaryMax: j.salaryRange?.interval === 'per-year-salary' ? j.salaryRange.max : undefined,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      openNow: true,
    }));
  }
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b.name}?includeCompensation=true`);
  return (data.jobs ?? [])
    .filter((j: any) => j.isListed !== false)
    .map((j: any) => {
      const pay = (j.compensation?.summaryComponents ?? []).find(
        (c: any) => c.compensationType === 'Salary' && c.interval === '1 YEAR'
      );
      return {
        source,
        externalId: ext(j.id),
        title: j.title,
        company: b.name,
        location: j.location,
        remote: !!j.isRemote || j.workplaceType === 'Remote',
        url: j.jobUrl,
        description: j.descriptionPlain ?? j.descriptionHtml,
        salaryMin: pay?.minValue,
        salaryMax: pay?.maxValue,
        postedAt: j.publishedAt,
        openNow: true,
      };
    });
}

/**
 * Reads each board and keeps postings that match: the keywords for an
 * on-demand search, or any criteria title for the scheduled sync.
 */
export async function fetchBoards(boards: Board[], p: SearchParams): Promise<{ results: BoardResult[]; errors: string[] }> {
  const titleTokens = (p.titles ?? []).map(keywordTokens).filter((t) => t.length);
  const keep = (l: RawListing) => {
    if (!withinDays(l.postedAt, p.postedWithinDays)) return false;
    if (p.remoteOnly && !l.remote) return false;
    if (titleTokens.length) return titleTokens.some((t) => matchesKeywords(l.title, t));
    return matchesKeywords(`${l.title} ${l.description ?? ''}`, keywordTokens(p.keywords));
  };

  const settled = await Promise.allSettled(boards.map(readBoard));
  const results: BoardResult[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    const b = boards[i];
    if (r.status === 'fulfilled') {
      results.push({ board: b, allIds: r.value.map((l) => l.externalId), listings: r.value.filter(keep) });
    } else {
      errors.push(`${b.kind}:${b.name} ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  });
  return { results, errors };
}
