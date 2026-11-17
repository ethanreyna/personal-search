import type { Criteria, ProfileDocument } from './sources/types';
import type { User } from './auth';
import example from '../criteria.example.json';

function parse<T>(raw: string | null, what: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`${what} is not valid JSON`, err);
    return undefined;
  }
}

/** The account's saved criteria, if it has set any. */
export function savedCriteria(user: Pick<User, 'criteria_json'>): Criteria | undefined {
  return parse<Criteria>(user.criteria_json, 'criteria');
}

/** Criteria used for scoring: the account's own, or the committed example until it sets some. */
export function getCriteria(user: Pick<User, 'criteria_json'>): Criteria {
  return { ...(example as Criteria), ...savedCriteria(user) };
}

/** Source for tailored documents and letters. Undefined until the account saves one. */
export function getDocumentSource(user: Pick<User, 'document_json'>): ProfileDocument | undefined {
  const doc = parse<ProfileDocument>(user.document_json, 'document');
  return doc?.name && doc.experience?.length ? doc : undefined;
}
