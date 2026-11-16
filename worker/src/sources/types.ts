export interface RawListing {
  source: string;
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  remote?: boolean;
  url: string;
  description?: string;
  salaryMin?: number;
  salaryMax?: number;
  postedAt?: string;
  applicants?: number;
  posterName?: string;
  posterTitle?: string;
  posterUrl?: string;
  companyWebsite?: string;
}

export interface OutreachProfile {
  /** Name used to sign off. */
  name: string;
  /** A few short, concrete facts about your background the writer can draw from. */
  background: string[];
  /** Optional links (portfolio, GitHub) appended under the signature. */
  links?: string[];
}

/** Source for the tailored PDF. Lives only in the private criteria file. */
export interface ProfileDocument {
  /** Download name, e.g. "Jane Doe.pdf". Defaults to "<name>.pdf". */
  fileName?: string;
  name: string;
  /** Lines under the name, e.g. "Email: ...". */
  contact: string[];
  education: Array<{ school: string; detail: string; date: string }>;
  skills: Array<{ label: string; items: string[] }>;
  experience: Array<{ company: string; title: string; dates: string; bullets: string[] }>;
  /** True facts not tied to an employer; may be used in the summary or skills. */
  extraFacts?: string[];
}

export interface Criteria {
  titles: string[];
  mustHaveAnySkills: string[];
  skills: string[];
  locations: string[];
  remoteOk: boolean;
  excludeKeywords: string[];
  targetYearsExperience: number;
  notes?: string;
  outreach?: OutreachProfile;
  document?: ProfileDocument;
}

/** On-demand search parameters entered in the dashboard. */
export interface SearchParams {
  keywords: string;
  location?: string;
  remoteOnly?: boolean;
  postedWithinDays?: number;
  limit?: number;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_PASSWORD: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  RAPIDAPI_KEY?: string;
  APIFY_TOKEN?: string;
  /** Optional override of the Apify actor used for the search. */
  APIFY_ACTOR?: string;
  HUNTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  /** Contents of the private worker/criteria.json. */
  CRITERIA_JSON?: string;
}
