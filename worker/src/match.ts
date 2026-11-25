import type { Criteria, RawListing } from './sources/types';
import { minYearsRequired } from './experience';
import { parseSalary, requirementFlags, type Flag } from './signals';

/**
 * Match % (0-100) between a listing and the criteria profile:
 *   title fit 30, skill coverage 40, experience 20, location 10.
 * Bump ALGO_VERSION when the formula changes so stored scores are redone.
 */
const ALGO_VERSION = 'm5';

// Technologies commonly named in listings. Anything here that a listing
// mentions and that isn't in the criteria skills counts as a gap.
const KNOWN_TECH = [
  'React', 'React Native', 'Next.js', 'Angular', 'Vue', 'Svelte', 'Ember.js', 'TypeScript', 'JavaScript',
  'jQuery', 'HTML', 'CSS', 'Sass', 'Tailwind', 'Redux', 'GraphQL', 'Node.js', 'Express', 'NestJS',
  'Deno', 'Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring Boot', 'Kotlin', 'Scala', 'Golang',
  'Rust', 'C++', 'C#', '.NET', 'Ruby', 'Rails', 'PHP', 'Laravel', 'Elixir', 'Swift', 'iOS',
  'Android', 'Flutter', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'DynamoDB', 'Elasticsearch',
  'Snowflake', 'Kafka', 'Spark', 'Airflow', 'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes',
  'Terraform', 'Jenkins', 'Salesforce', 'SAP', 'ServiceNow', 'Figma', 'Temporal',
  'Mapbox', 'RxDB', 'Astro', 'Vite', 'Webpack', 'Jest', 'Cypress', 'Playwright', 'Storybook',
];

// Extra spellings for terms that are written several ways.
const ALIASES: Record<string, string[]> = {
  'next.js': ['nextjs', 'next js'],
  'node.js': ['nodejs', 'node'],
  'react': ['react.js', 'reactjs'],
  'react native': ['react-native'],
  'vue': ['vue.js', 'vuejs'],
  'express': ['express.js', 'expressjs'],
  'postgresql': ['postgres'],
  'gcp': ['google cloud'],
  'golang': ['go lang'],
  'aws': ['amazon web services'],
  'materialui': ['material ui', 'material-ui', 'mui'],
  'kubernetes': ['k8s'],
  '.net': ['dotnet', 'asp.net'],
  'c#': ['csharp'],
  'rails': ['ruby on rails'],
};

const ROLE_WORDS = ['engineer', 'developer', 'programmer', 'software', 'frontend', 'front end', 'full stack', 'fullstack', 'web', 'ui', 'react', 'javascript', 'typescript'];
const HIGH_LEVEL = ['staff', 'principal', 'director', 'manager', 'head', 'vp', 'architect', 'distinguished'];
const SENIOR = ['senior', 'sr', 'lead', 'iii', 'iv'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = new Map<string, RegExp>();
function has(text: string, term: string): boolean {
  const key = term.toLowerCase();
  let re = termRe.get(key);
  if (!re) {
    const forms = [key, ...(ALIASES[key] ?? [])].map(escape).join('|');
    re = new RegExp(`(?<![a-z0-9+#])(?:${forms})(?![a-z0-9+#]|\\.[a-z])`);
    termRe.set(key, re);
  }
  return re.test(text);
}

interface Vocab {
  re: RegExp;
  /** Matched spelling -> canonical lowercased term. */
  canon: Map<string, string>;
  /** Canonical term -> display label. */
  label: Map<string, string>;
}

// One alternation over every spelling, so each listing's text is scanned once.
const vocabCache = new WeakMap<Criteria, Vocab>();
function vocabFor(criteria: Criteria): Vocab {
  const cached = vocabCache.get(criteria);
  if (cached) return cached;
  const canon = new Map<string, string>();
  const label = new Map<string, string>();
  for (const t of [...KNOWN_TECH, ...criteria.skills, ...criteria.mustHaveAnySkills]) {
    const key = t.toLowerCase();
    if (!label.has(key)) label.set(key, t);
    for (const form of [key, ...(ALIASES[key] ?? [])]) {
      if (!canon.has(form)) canon.set(form, key);
    }
  }
  const forms = [...canon.keys()].sort((a, b) => b.length - a.length).map(escape).join('|');
  const re = new RegExp(`(?<![a-z0-9+#])(?:${forms})(?![a-z0-9+#]|\\.[a-z])`, 'g');
  const v = { re, canon, label };
  vocabCache.set(criteria, v);
  return v;
}

function plain(s: string | undefined): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface MatchResult {
  score: number;
  /** Short explanation shown on the card, e.g. "Has React, TypeScript · Missing AWS". */
  notes: string;
  flags: Flag[];
  /** top = clear match with pay listed and nothing to check; second = worth a look but needs judgement; low = the rest. */
  tier: 'top' | 'second' | 'low';
  /** Why it is shown, e.g. "Title match (Frontend Engineer) · remote · pay listed". */
  why: string;
  /** What to check before spending time on it. Empty for top listings. */
  check: string;
  /** Yearly pay parsed from the text, when the source didn't give one. */
  parsedPay: { min: number; max: number } | null;
}

const money = (n: number) => `${Math.round(n / 1000)}k`;

export function matchListing(listing: RawListing, criteria: Criteria, minYears?: number | null): MatchResult {
  const title = plain(listing.title);
  const body = plain(listing.description);
  const text = `${title} ${body}`;
  const mine = new Set(criteria.skills.map((s) => s.toLowerCase()));
  const core = criteria.mustHaveAnySkills;

  // Title fit (30)
  let titlePts = 0;
  const exactTitle = criteria.titles.find((t) => title.includes(t.toLowerCase()));
  if (exactTitle) titlePts = 30;
  else if (ROLE_WORDS.some((w) => has(title, w))) titlePts = 18;
  if (HIGH_LEVEL.some((w) => has(title, w))) titlePts -= 20;
  else if (SENIOR.some((w) => has(title, w))) titlePts -= 8;
  titlePts = Math.max(0, titlePts);

  // Skill coverage (40): share of the named tech you have, plus your core stack showing up.
  const vocab = vocabFor(criteria);
  const named = new Set<string>();
  for (const m of text.matchAll(vocab.re)) named.add(vocab.canon.get(m[0]) ?? m[0]);
  const matched = [...named].filter((t) => mine.has(t));
  const missing = [...named].filter((t) => !mine.has(t));
  // Pulled toward 50% when a listing names only a couple of technologies.
  const coverage = (matched.length + 1) / (named.size + 2);
  const coreHit = core.some((s) => named.has(s.toLowerCase()));
  const skillPts = 28 * coverage + (coreHit ? 12 : 0);

  // Experience (20)
  const years = minYears === undefined ? minYearsRequired(listing.description ?? '') : minYears;
  const target = criteria.targetYearsExperience;
  let expPts = 15;
  if (years !== null) expPts = years <= target ? 20 : years <= target + 1 ? 10 : years <= target + 3 ? 4 : 0;

  // Location (10)
  const loc = (listing.location ?? '').toLowerCase();
  const nearby = criteria.locations.some((l) => !/remote/i.test(l) && loc.includes(l.toLowerCase().split(',')[0]));
  const locPts = (listing.remote && criteria.remoteOk) || nearby ? 10 : 0;

  let score = titlePts + skillPts + expPts + locPts;
  for (const ex of criteria.excludeKeywords) {
    if (ex && text.includes(ex.toLowerCase())) score -= 50;
  }

  const label = (t: string) => vocab.label.get(t) ?? t;
  const parts: string[] = [];
  if (matched.length) parts.push(`Has ${matched.slice(0, 8).map(label).join(', ')}`);
  if (missing.length) parts.push(`Missing ${missing.slice(0, 6).map(label).join(', ')}`);
  if (years !== null) parts.push(`${years}+ yrs asked`);

  const final = Math.max(0, Math.min(100, Math.round(score)));

  // Flags, tier and the reasons shown on the card.
  const flags: Flag[] = [];
  const why: string[] = [];
  const check: string[] = [];
  const closeTo = criteria.titles.find((t) => t.toLowerCase().split(/\s+/).filter((w) => w.length > 2).some((w) => has(title, w)));
  if (exactTitle) {
    flags.push({ code: 'title_exact', label: 'Title match', kind: 'good' });
    why.push(`Title match (${exactTitle})`);
  } else if (titlePts > 0) {
    flags.push({ code: 'title_close', label: 'Close title match', kind: 'info' });
    why.push(closeTo ? `Close to your title "${closeTo}"` : 'Related title');
    check.push(`The title is only close to yours${closeTo ? ` ("${closeTo}")` : ''}. Check the duties.`);
  }
  if (HIGH_LEVEL.some((w) => has(title, w))) {
    flags.push({ code: 'level', label: 'Above your level', kind: 'warn' });
    check.push('The title is above your level.');
  } else if (SENIOR.some((w) => has(title, w))) {
    flags.push({ code: 'level', label: 'Senior title', kind: 'info' });
    check.push('Senior title. Check whether the years and scope fit.');
  }
  if (listing.remote) why.push('remote');
  else if (nearby) why.push(listing.location ?? 'near you');

  // Under $20k a year is almost always monthly, another currency, or a placeholder, so it counts as not listed.
  const sane = (n: number | undefined) => (n && n >= 20_000 ? n : undefined);
  const parsedPay = sane(listing.salaryMin) || sane(listing.salaryMax) ? null : parseSalary(listing.description);
  const payMax = sane(listing.salaryMax) ?? sane(listing.salaryMin) ?? parsedPay?.max;
  const payMin = sane(listing.salaryMin) ?? sane(listing.salaryMax) ?? parsedPay?.min;
  const payTarget = criteria.minSalary;
  if (!payMax) {
    flags.push({ code: 'pay_missing', label: 'Pay not listed', kind: 'info' });
    check.push('Pay not listed.');
  } else if (payTarget && payMax < payTarget) {
    flags.push({ code: 'pay_below', label: 'Pay below your target', kind: 'warn' });
    check.push(`Top of the range (${money(payMax)}) is under your target of ${money(payTarget)}.`);
  } else if (payTarget && payMin && payMin >= payTarget) {
    flags.push({ code: 'pay_above', label: 'Pay above your target', kind: 'good' });
    why.push('pay above your target');
  } else {
    why.push(`pay listed (${money(payMin ?? payMax)}${payMin && payMin !== payMax ? `–${money(payMax)}` : ''})`);
  }

  if (years !== null && years > criteria.targetYearsExperience + 1) {
    flags.push({ code: 'too_senior', label: `${years}+ yrs asked`, kind: 'warn' });
    check.push(`Asks for ${years}+ years; you have ${criteria.targetYearsExperience}.`);
  }
  for (const f of requirementFlags(listing.description ?? '')) {
    flags.push(f);
    check.push(`${f.label}.`);
  }

  const warns = flags.some((f) => f.kind === 'warn');
  const tier: MatchResult['tier'] =
    final >= 60 && exactTitle && payMax && !warns && !flags.some((f) => f.code === 'level') ? 'top' : final >= 45 || (exactTitle && final >= 35) ? 'second' : 'low';

  return {
    score: final,
    notes: parts.join(' · '),
    flags,
    tier,
    why: why.join(' · '),
    check: tier === 'top' ? '' : check.join(' '),
    parsedPay,
  };
}

/** Changes whenever the criteria (minus the outreach text) or the formula change. */
export function matchVersion(criteria: Criteria): string {
  const { outreach: _o, notes: _n, ...rest } = criteria;
  const s = ALGO_VERSION + JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ALGO_VERSION + '-' + (h >>> 0).toString(36);
}
