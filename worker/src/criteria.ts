import type { Criteria, Env } from './sources/types';
import example from '../criteria.example.json';

let cached: { raw: string; value: Criteria } | null = null;

/**
 * Real criteria live in the CRITERIA_JSON secret (the contents of the
 * gitignored worker/criteria.json), so builds from the repo never need the
 * private file. Falls back to the committed example when the secret is unset
 * or invalid.
 */
export function getCriteria(env: Env): Criteria {
  const raw = env.CRITERIA_JSON;
  if (!raw) return example as Criteria;
  if (cached?.raw === raw) return cached.value;
  try {
    const value = JSON.parse(raw) as Criteria;
    cached = { raw, value };
    return value;
  } catch (err) {
    console.error('CRITERIA_JSON is not valid JSON, using example criteria', err);
    return example as Criteria;
  }
}
