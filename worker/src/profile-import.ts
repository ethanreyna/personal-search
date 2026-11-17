import Anthropic from '@anthropic-ai/sdk';
import type { Criteria, Env, ProfileDocument } from './sources/types';

/** What an uploaded PDF is read into. Nothing is saved until the person reviews it. */
export interface ImportedProfile {
  document: ProfileDocument;
  criteria: Criteria;
}

const SYSTEM = `You read a person's one or two page professional profile document (a PDF) and copy its contents into structured fields, then suggest search criteria from it.

Document fields:
- Copy text faithfully. Do not rewrite, summarize, improve, or add anything. Fix only obvious extraction artifacts (broken hyphenation, stray bullet characters).
- contact: one line per contact item as shown, e.g. "Email: name@example.com", "Phone: ...", "GitHub: ...". Keep the label if the document has one.
- education: school, detail (degree and field, honors), date. Use "" for anything missing.
- skills: keep the document's own groups and labels. If skills are a single list, use one group labelled "Skills".
- experience: every role in document order, with company, title, dates exactly as written, and every bullet.
- extraFacts: true statements that are in the document but not tied to one employer (projects, certifications, languages). Empty if none.

Criteria suggestions:
- titles: 3 to 6 role titles this person would search for, based on their titles and stack, at their current level.
- skills: every technology, language, framework, and tool in the document, using common spellings (e.g. "Node.js", "PostgreSQL").
- mustHaveAnySkills: the 2 to 4 core technologies of their main stack.
- locations: their city if the document gives one (e.g. "Austin, TX"), plus "Remote".
- targetYearsExperience: total years of professional experience, rounded down.
- background: 4 to 7 short factual sentences in first person a writer could draw on: what they built, with what, and any numbers, exactly as the document states them.`;

const str = { type: 'string' } as const;
const strs = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const SCHEMA = obj({
  name: str,
  contact: strs,
  education: { type: 'array', items: obj({ school: str, detail: str, date: str }) },
  skills: { type: 'array', items: obj({ label: str, items: strs }) },
  experience: { type: 'array', items: obj({ company: str, title: str, dates: str, bullets: strs }) },
  extraFacts: strs,
  titles: strs,
  allSkills: strs,
  mustHaveAnySkills: strs,
  locations: strs,
  remoteOk: { type: 'boolean' },
  targetYearsExperience: { type: 'integer' },
  background: strs,
});

type Extracted = Omit<ProfileDocument, 'fileName' | 'letterFileName'> & {
  extraFacts: string[];
  titles: string[];
  allSkills: string[];
  mustHaveAnySkills: string[];
  locations: string[];
  remoteOk: boolean;
  targetYearsExperience: number;
  background: string[];
};

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export async function importProfilePdf(env: Env, pdfBase64: string): Promise<ImportedProfile> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: 'Copy this document into the fields and suggest criteria.' },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('The model declined to read this file');
  if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off; try a shorter file');

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let x: Extracted;
  try {
    x = JSON.parse(text);
  } catch {
    throw new Error('Could not read the result; try again');
  }

  return {
    document: {
      fileName: `${x.name}.pdf`,
      letterFileName: `${x.name} Letter.pdf`,
      name: x.name,
      contact: x.contact,
      education: x.education,
      skills: x.skills,
      experience: x.experience,
      extraFacts: x.extraFacts,
    },
    criteria: {
      titles: x.titles,
      skills: x.allSkills,
      mustHaveAnySkills: x.mustHaveAnySkills,
      locations: x.locations,
      remoteOk: x.remoteOk,
      excludeKeywords: [],
      targetYearsExperience: x.targetYearsExperience,
      outreach: { name: x.name, background: x.background, links: [] },
    },
  };
}
