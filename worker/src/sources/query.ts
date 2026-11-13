import type { Criteria, SearchParams } from './types';

/** Lowercased keyword tokens worth matching on (drops one-letter noise). */
export function keywordTokens(keywords: string): string[] {
  return keywords
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1);
}

/** True when every keyword token appears somewhere in the text. */
export function matchesKeywords(text: string, tokens: string[]): boolean {
  const hay = text.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** "Houston, Texas, United States" -> "Houston, Texas" for APIs that dislike the country suffix. */
export function shortLocation(location?: string): string | undefined {
  const l = location?.replace(/,?\s*United States$/i, '').trim();
  return l || undefined;
}

export function withinDays(postedAt: string | undefined, days?: number): boolean {
  if (!days || !postedAt) return true;
  const t = new Date(postedAt).getTime();
  return isNaN(t) || t >= Date.now() - days * 86400_000;
}

/** Search used by the scheduled sync, derived from the criteria file. */
export function paramsFromCriteria(criteria: Criteria): SearchParams {
  return {
    keywords: criteria.titles[0] ?? 'software engineer',
    location: criteria.locations.find((l) => !/remote/i.test(l)),
    remoteOnly: false,
    postedWithinDays: 7,
    limit: 50,
  };
}
