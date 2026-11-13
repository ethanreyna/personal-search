import Anthropic from '@anthropic-ai/sdk';
import type { Env, OutreachProfile } from './sources/types';

export interface Draft {
  subject: string;
  body: string;
}

const SYSTEM = `You write short cold emails that a real person would send to the person who posted an open role. The sender is interested in the role and wants a reply.

Voice:
- Plain, direct, a little informal. Contractions are fine. Write like a competent engineer, not a marketer.
- 60 to 110 words in the body. Two or three short paragraphs. No bullet points, no headings, no bold.
- Start with "Hi <first name>," on its own line (use "Hi there," if no name is given).
- First sentence says which role they posted and that the sender is interested. Do not open with pleasantries.
- Then one or two specific things from the sender's background that line up with something concrete in the posting. Name the actual tech or work, not adjectives about it.
- End with one low-pressure ask: a short call, or whether they'd like more detail. Then sign off with only the sender's name (and links, if given, on the lines below).

Never use: em dashes or en dashes, exclamation marks, semicolons, "I hope this email finds you well", "I came across", "I'm reaching out", "excited", "thrilled", "passionate", "leverage", "delve", "synergy", "align with", "fast-paced", "dynamic", "robust", "seamless", "cutting-edge", "game-changer", "proven track record", "I believe I would be a great fit", "Best regards", "Warm regards". No rule-of-three lists of adjectives.

Only use facts from the sender's background. Do not invent numbers, employers, or skills. If the posting asks for something the sender doesn't have, don't mention it.

Output format, exactly:
Subject: <subject, under 8 words, no colon after the role, no emoji>

<body>`;

/** Catch the few tells the prompt can still let through. */
function scrub(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/!/g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();
}

function parse(text: string): Draft {
  const m = text.match(/^\s*Subject:\s*(.+?)\s*\n+([\s\S]*)$/i);
  if (!m) return { subject: '', body: scrub(text) };
  return { subject: scrub(m[1]), body: scrub(m[2]) };
}

export async function draftOutreach(
  env: Env,
  profile: OutreachProfile,
  listing: {
    title: string;
    company: string | null;
    description: string | null;
    poster_name: string | null;
    poster_title: string | null;
  }
): Promise<Draft> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const firstName = listing.poster_name?.trim().split(/\s+/)[0] ?? '';
  const user = [
    `Recipient: ${listing.poster_name ?? '(unknown)'}${listing.poster_title ? `, ${listing.poster_title}` : ''}`,
    `Recipient first name: ${firstName || '(unknown)'}`,
    `Role: ${listing.title}`,
    `Company: ${listing.company ?? '(unknown)'}`,
    '',
    'Posting:',
    listing.description ?? '(no description available)',
    '',
    `Sender name: ${profile.name}`,
    'Sender background:',
    ...profile.background.map((b) => `- ${b}`),
    ...(profile.links?.length ? ['', 'Sender links:', ...profile.links] : []),
  ].join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to write this draft');
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return parse(text);
}
