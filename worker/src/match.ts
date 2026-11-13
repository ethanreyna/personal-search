import type { Criteria, RawListing } from './sources/types';
import { minYearsRequired } from './experience';

/**
 * Match % (0-100) between a listing and the criteria profile:
 *   title fit 30, skill coverage 40, experience 20, location 10.
 * Bump ALGO_VERSION when the formula changes so stored scores are redone.
 */
const ALGO_VERSION = 'm3';

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
}

export function matchListing(listing: RawListing, criteria: Criteria, minYears?: number | null): MatchResult {
  const title = plain(listing.title);
  const body = plain(listing.description);
  const text = `${title} ${body}`;
  const mine = new Set(criteria.skills.map((s) => s.toLowerCase()));
  const core = criteria.mustHaveAnySkills;

  // Title fit (30)
  let titlePts = 0;
  if (criteria.titles.some((t) => title.includes(t.toLowerCase()))) titlePts = 30;
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

  return { score: Math.max(0, Math.min(100, Math.round(score))), notes: parts.join(' · ') };
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
