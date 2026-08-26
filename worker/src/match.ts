import type { Criteria, RawListing } from './sources/types';

export function scoreListing(listing: RawListing, criteria: Criteria): number {
  const text = `${listing.title} ${listing.description ?? ''}`.toLowerCase();
  let score = 0;

  if (criteria.titles.some((t) => listing.title.toLowerCase().includes(t.toLowerCase()))) {
    score += 30;
  }

  if (criteria.mustHaveAnySkills.length) {
    const hasMustHave = criteria.mustHaveAnySkills.some((s) => text.includes(s.toLowerCase()));
    if (!hasMustHave) score -= 20;
  }

  let skillHits = 0;
  for (const s of criteria.skills) {
    if (text.includes(s.toLowerCase())) skillHits++;
  }
  score += Math.min(skillHits * 4, 40);

  const loc = (listing.location ?? '').toLowerCase();
  if (listing.remote && criteria.remoteOk) {
    score += 20;
  } else if (criteria.locations.some((l) => loc.includes(l.toLowerCase()))) {
    score += 15;
  }

  for (const ex of criteria.excludeKeywords) {
    if (ex && text.includes(ex.toLowerCase())) score -= 50;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
