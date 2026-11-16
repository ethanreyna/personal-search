import Anthropic from '@anthropic-ai/sdk';
import type { Env, OutreachProfile, ProfileDocument } from './sources/types';

const SYSTEM = `You write the one-page letter a person sends along with their profile document when responding to a listing. It has to read like the person wrote it themselves on a weeknight: specific, plain, a little informal, and clearly about this one listing.

Shape:
- Greeting on its own line: "Hi <first name>," if a contact name is given, otherwise "Hello <organization> team,".
- Three or four short paragraphs, 200 to 280 words in total for the body.
- Paragraph 1: which role, and one concrete reason this listing caught their attention, taken from something specific in the listing text (the product, the problem, the stack). Do not open with "I am writing to", "I am excited", or a compliment about the company.
- Paragraphs 2 and 3: two or three specific pieces of past work that match what the listing asks for. Name the actual thing built and the tools used, and keep any numbers exactly as given. Connect each one to the listing in plain words. Do not restate the whole profile document.
- Last paragraph: one or two sentences. A simple, low-key close (happy to talk, can share more detail). No begging, no "I look forward to the opportunity to contribute".
- Sign-off on its own lines: "Thanks," then the person's name.

Voice:
- Write like a competent engineer talking to another person. Short and medium sentences, varied. Contractions are fine. First person, active voice.
- Prefer concrete nouns and verbs over adjectives. One idea per sentence.
- It's fine to be a little understated. It is not fine to be gushing, salesy, or formal.

Never use: em dashes, en dashes, semicolons, exclamation marks, rhetorical questions, bullet points, headings, bold, or any of these words and phrases: "excited", "thrilled", "passionate", "eager", "delighted", "keen", "leverage", "utilize", "delve", "synergy", "align", "aligns", "resonate", "resonates", "spearhead", "seamless", "robust", "dynamic", "fast-paced", "cutting-edge", "innovative", "game-changer", "landscape", "tapestry", "journey", "testament", "furthermore", "moreover", "additionally", "in today's", "I am confident", "I believe I would be", "proven track record", "make an impact", "hit the ground running", "unique blend", "perfect fit", "valuable asset", "the opportunity to contribute", "I came across", "I'm reaching out", "Thank you for your time and consideration", "Sincerely", "Best regards", "Warm regards". No lists of three adjectives. No sentence that could be pasted into a letter for a different organization.

Facts: use only what is in the person's profile and background notes. Never invent employers, titles, numbers, tools, or achievements. If the listing asks for something the person lacks, don't mention it and don't claim it.

Output only the letter text, from the greeting through the name. Nothing before or after it.`;

/** Catch the few tells the prompt can still let through. */
export function scrubLetter(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/;\s*/g, ', ')
    .replace(/!/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function writeLetter(
  env: Env,
  source: ProfileDocument,
  outreach: OutreachProfile | undefined,
  listing: { title: string; company: string | null; description: string | null; poster_name: string | null }
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const firstName = listing.poster_name?.trim().split(/\s+/)[0] ?? '';
  const user = [
    `Role: ${listing.title}`,
    `Organization: ${listing.company ?? '(unknown)'}`,
    `Contact first name: ${firstName || '(none)'}`,
    '',
    'Listing text:',
    (listing.description ?? '(no description available)').replace(/<[^>]+>/g, ' ').slice(0, 20000),
    '',
    `Person's name: ${source.name}`,
    "Person's profile (JSON):",
    JSON.stringify({ education: source.education, skills: source.skills, experience: source.experience }, null, 1),
    ...(source.extraFacts?.length ? ['', 'Other true facts:', ...source.extraFacts.map((f) => `- ${f}`)] : []),
    ...(outreach?.background?.length ? ['', 'Background notes:', ...outreach.background.map((b) => `- ${b}`)] : []),
  ].join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') throw new Error('The model declined to write this one');

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return scrubLetter(text);
}
