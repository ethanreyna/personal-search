const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15,
};

// "3+ years", "3 - 5 years", "3 to 5 years", "3 or more years", "3+ yrs"
const YEARS_RE =
  /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?(?:or more\s+|or greater\s+)?(?:years?|yrs?)\b/g;

const SOFT_RE = /\b(preferred|nice to have|a plus|bonus|ideally)\b/;

/**
 * Best guess at the minimum years of experience a description asks for.
 * Takes the largest stated minimum, ignoring mentions marked as preferred
 * and numbers that aren't about experience (company age, etc.).
 * Returns null when nothing is stated.
 */
export function minYearsRequired(description: string | null | undefined): number | null {
  if (!description) return null;

  const text = description
    .toLowerCase()
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)\b/g, (w) =>
      String(NUMBER_WORDS[w])
    )
    // "three (3) years" -> "3 (3) years" -> "3 years"
    .replace(/(\d)\s*\(\s*\d+\s*\)/g, '$1');

  let best: number | null = null;
  for (const m of text.matchAll(YEARS_RE)) {
    const n = Number(m[1]);
    if (n > 20) continue;

    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = text.slice(Math.max(0, start - 50), start);
    const after = text.slice(end, end + 70);
    // Stay within the same sentence / bullet.
    const beforeClause = before.split(/[.;\n•]/).pop() ?? '';
    const afterClause = after.split(/[.;\n•]/)[0] ?? '';

    const aboutExperience =
      /experience|exp\b/.test(afterClause) ||
      /experience|minimum|at least|requires?|required/.test(beforeClause);
    if (!aboutExperience) continue;
    if (/\b(old|ago|in business|history)\b/.test(afterClause.slice(0, 20))) continue;
    if (SOFT_RE.test(afterClause) || SOFT_RE.test(beforeClause)) continue;

    best = best === null ? n : Math.max(best, n);
  }
  return best;
}

/** Normalizes a user-entered word list: "Senior, Sr., lead" -> ["senior", "sr", "lead"]. */
export function parseWordList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .split(',')
    .map((w) => w.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30);
}
