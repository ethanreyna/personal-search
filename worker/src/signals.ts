// Facts read out of listing text: pay, and requirements worth a second look.

/** Decodes the HTML entities that show up in board feeds ("&lt;p&gt;" etc.). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function plainText(s: string | null | undefined): string {
  return decodeEntities((s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// A dollar amount, optionally in thousands; millions and billions (funding, revenue) don't match.
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?(?!\s*(?:m|mm|b|bn|million|billion)\b)`;
const PAY_RE = new RegExp(
  String.raw`\$\s?${AMOUNT}(?:\s*(?:-|–|—|to)\s*\$?\s?${AMOUNT})?\s*(?:usd\s*)?(?:(?:/|per|an|a)\s*)?(hour|hr|year|yr|annum|annually)?`,
  'gi'
);

/** Yearly pay range stated in the text ("$120,000 - $150,000", "$60/hr", "$140k"). Null when none is stated. */
export function parseSalary(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const toNum = (n: string, k: string | undefined) => Number(n.replace(/,/g, '')) * (k ? 1000 : 1);
  for (const m of plainText(text).matchAll(PAY_RE)) {
    let lo = toNum(m[1], m[2]);
    let hi = m[3] ? toNum(m[3], m[4] ?? m[2]) : lo;
    const unit = (m[5] ?? '').toLowerCase();
    // Small numbers are hourly only when it says so, or when given as a range ("$45 - $55").
    if (!unit && hi < 300 && !m[3]) continue;
    if (unit === 'hour' || unit === 'hr' || (!unit && hi < 300)) {
      if (hi < 15 || hi > 300) continue;
      lo *= 2080;
      hi *= 2080;
    }
    if (lo < 20_000 || hi > 1_000_000 || hi < lo) continue;
    return { min: Math.round(lo), max: Math.round(hi) };
  }
  return null;
}

/** Same title at the same organization counts as one posting, whichever source it came from. */
export function dupeKey(title: string, company: string | null | undefined): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\((?:m|f|w|d|x|all genders?)[^)]*\)/g, ' ')
      .replace(/\b(remote|hybrid|on ?site|us|usa|united states|full ?time|contract)\b/g, ' ')
      .replace(/\b(inc|llc|ltd|corp|corporation|co|company|gmbh)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(company ?? '')}|${norm(title)}`;
}

export type FlagCode =
  | 'title_exact'
  | 'title_close'
  | 'pay_above'
  | 'pay_below'
  | 'pay_missing'
  | 'clearance'
  | 'citizenship'
  | 'travel'
  | 'degree'
  | 'too_senior'
  | 'level';

export interface Flag {
  code: FlagCode;
  label: string;
  /** good = a reason to look, warn = check before spending time, info = unknown. */
  kind: 'good' | 'warn' | 'info';
}

/** Requirements stated in the text that are worth checking before spending time on a listing. */
export function requirementFlags(text: string): Flag[] {
  const t = plainText(text).toLowerCase();
  const out: Flag[] = [];

  if (
    /\b(security clearance|secret clearance|top secret|ts\/sci|active clearance|clearance is required|obtain (?:and maintain )?a (?:security )?clearance|public trust)\b/.test(t) &&
    !/\bno (?:security )?clearance\b/.test(t)
  ) {
    out.push({ code: 'clearance', label: 'Security clearance', kind: 'warn' });
  }
  if (/\b(u\.?s\.? citizenship (?:is )?required|must be a u\.?s\.? citizen|united states citizenship is required)\b/.test(t)) {
    out.push({ code: 'citizenship', label: 'Citizenship required', kind: 'info' });
  }
  const travel = t.match(/\btravel(?:ing)?[^.]{0,40}?(\d{1,3})\s?%|(\d{1,3})\s?%[^.]{0,20}?\btravel/);
  const travelPct = travel ? Number(travel[1] ?? travel[2]) : null;
  if ((travelPct !== null && travelPct >= 20) || /\b(extensive travel|frequent travel|travel is required)\b/.test(t)) {
    out.push({ code: 'travel', label: travelPct ? `Travel up to ${travelPct}%` : 'Travel required', kind: 'warn' });
  }
  const degree = t.match(/\b(bachelor'?s|master'?s|ph\.?d|b\.?s\.?|degree)\b[^.]{0,80}/g) ?? [];
  if (
    degree.some((d) => /\b(required|requires|must have|minimum)\b/.test(d)) &&
    !/\bor equivalent (?:practical |work )?experience\b|\bdegree (?:is )?(?:preferred|a plus|not required)\b/.test(t)
  ) {
    out.push({ code: 'degree', label: 'Degree required', kind: 'info' });
  }
  return out;
}
