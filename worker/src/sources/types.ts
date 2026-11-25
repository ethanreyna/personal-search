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
  /** Set when the source itself proves the posting is open right now (an employer board, an open close date). */
  openNow?: boolean;
  /** Last day to respond, when the source gives one. */
  closesAt?: string;
}

export interface OutreachProfile {
  /** Name used to sign off. */
  name: string;
  /** A few short, concrete facts about your background the writer can draw from. */
  background: string[];
  /** Optional links (portfolio, GitHub) appended under the signature. */
  links?: string[];
}

/** Source for the tailored PDF, saved per account from the Profile page. */
export interface ProfileDocument {
  /** Download name, e.g. "Jane Doe.pdf". Defaults to "<name>.pdf". The organization is appended. */
  fileName?: string;
  /** Download name for the letter. Defaults to "<name> Letter.pdf". The organization is appended. */
  letterFileName?: string;
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
  /** Lowest pay worth considering (yearly). Listings below it are flagged, above it are noted. */
  minSalary?: number;
  /** Sources turned off for this account. Everything else configured is used. */
  disabledSources?: string[];
  /** Employer boards to watch, as "greenhouse:token", "lever:company" or "ashby:board". */
  boards?: string[];
}

/** On-demand search parameters entered in the dashboard. */
export interface SearchParams {
  keywords: string;
  location?: string;
  remoteOnly?: boolean;
  postedWithinDays?: number;
  limit?: number;
  /** Titles from the criteria; employer boards keep postings whose title matches one (used by the scheduled sync). */
  titles?: string[];
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Old shared password; only used once for the original account's first sign-in. */
  ACCESS_PASSWORD?: string;
  /** Code required to create an account. Sign-up is closed when unset. */
  INVITE_CODE?: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  RAPIDAPI_KEY?: string;
  APIFY_TOKEN?: string;
  /** Optional override of the Apify actor used for the search. */
  APIFY_ACTOR?: string;
  HUNTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  JOOBLE_API_KEY?: string;
  /** Federal listings API key, and the email address it was registered with (sent as User-Agent, as that API requires). */
  FEDERAL_API_KEY?: string;
  FEDERAL_API_EMAIL?: string;
}
