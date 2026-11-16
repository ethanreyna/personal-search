import Anthropic from '@anthropic-ai/sdk';
import type { Env, ProfileDocument } from './sources/types';

/** What the dashboard renders into a PDF. Contact, education, titles and dates come straight from the source. */
export interface TailoredDocument {
  fileName: string;
  name: string;
  contact: string[];
  summary: string;
  education: ProfileDocument['education'];
  skills: Array<{ label: string; items: string[] }>;
  experience: Array<{ company: string; title: string; dates: string; bullets: string[] }>;
  /** One or two lines on what was emphasized, shown in the dashboard. */
  changes: string;
}

const SYSTEM = `You tailor a person's professional profile document (summary, skills, work history) to one specific listing so that a reader screening for that listing sees the relevant experience first.

Rules:
- Use only facts present in the source document and the extra facts provided. Never invent employers, titles, dates, numbers, metrics, tools, or responsibilities. If the listing asks for something the person doesn't have, leave it out; do not imply it.
- Extra facts that don't name an employer may appear in the summary or skills only, not inside a specific employer's bullets.
- Keep every employer, in the original order. For each, return 3 to 6 bullets: reorder so the most relevant come first, rephrase to use the listing's own terms where they truthfully describe the same work, merge or drop the least relevant ones. Each bullet is one sentence, ideally under 30 words, starting with a strong past-tense verb (present tense for a current role is fine).
- Keep the numbers that exist in the source exactly as written.
- Summary: 2 sentences, under 45 words, plain and specific, naming the stack and kind of work that matches the listing. No "passionate", "results-driven", "dynamic", "proven track record", "leverage", "synergy", "detail-oriented", "team player", "fast-paced".
- Skills: keep the source's groups (you may rename a group slightly), put listing-relevant items first in each group, drop items that add nothing for this listing, never add items not in the source or extra facts.
- Plain ASCII punctuation: no em or en dashes, no curly quotes, no semicolons.
- The whole document should fit on one page: about 450 to 550 words in total across summary, skills and bullets.
- "changes": one or two short sentences telling the person what you emphasized and anything the listing asks for that they lack.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'skills', 'experience', 'changes'],
  properties: {
    summary: { type: 'string' },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'items'],
        properties: { label: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
      },
    },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'bullets'],
        properties: { company: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } },
      },
    },
    changes: { type: 'string' },
  },
} as const;

/** Catch the few tells the prompt can still let through, and keep text PDF-font safe. */
function clean(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/;\s*/g, ', ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function tailorDocument(
  env: Env,
  source: ProfileDocument,
  listing: { title: string; company: string | null; description: string | null }
): Promise<TailoredDocument> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const user = [
    `Listing title: ${listing.title}`,
    `Organization: ${listing.company ?? '(unknown)'}`,
    'Listing text:',
    (listing.description ?? '(no description available)').replace(/<[^>]+>/g, ' ').slice(0, 20000),
    '',
    'Source document (JSON):',
    JSON.stringify({ skills: source.skills, experience: source.experience, education: source.education }, null, 1),
    ...(source.extraFacts?.length ? ['', 'Extra facts (true, employer not specified):', ...source.extraFacts.map((f) => `- ${f}`)] : []),
  ].join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as any } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') throw new Error('The model declined to tailor this one');
  if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off; try again');

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let out: { summary: string; skills: Array<{ label: string; items: string[] }>; experience: Array<{ company: string; bullets: string[] }>; changes: string };
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error('Could not read the generated document; try again');
  }

  // Employers, titles and dates always come from the source, in source order.
  const byCompany = new Map(out.experience.map((e) => [e.company.trim().toLowerCase(), e.bullets]));
  const experience = source.experience.map((e, i) => {
    const bullets = byCompany.get(e.company.trim().toLowerCase()) ?? out.experience[i]?.bullets ?? e.bullets;
    return { company: e.company, title: e.title, dates: e.dates, bullets: bullets.map(clean).filter(Boolean) };
  });

  return {
    fileName: source.fileName || `${source.name}.pdf`,
    name: source.name,
    contact: source.contact,
    summary: clean(out.summary),
    education: source.education,
    skills: out.skills
      .map((g) => ({ label: clean(g.label), items: g.items.map(clean).filter(Boolean) }))
      .filter((g) => g.items.length),
    experience,
    changes: clean(out.changes),
  };
}
