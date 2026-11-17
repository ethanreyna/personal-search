export interface Listing {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company: string | null;
  location: string | null;
  remote: number;
  url: string;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  fetched_at: string;
  score: number;
  status: 'new' | 'saved' | 'dismissed' | 'applied';
  applicants: number | null;
  poster_name: string | null;
  poster_title: string | null;
  poster_url: string | null;
  company_website: string | null;
  contact_email: string | null;
  contact_status: 'found' | 'not_found' | 'no_poster' | null;
  contact_score: number | null;
  min_years: number | null;
  match_notes: string | null;
  has_document: number;
  has_letter: number;
  draft_subject: string | null;
  draft_body: string | null;
}

export interface SearchForm {
  keywords: string;
  location: string;
  remoteOnly: boolean;
  postedWithinDays: number;
  maxApplicants: number | '';
  maxYears: number | '';
  excludeTitle: string;
  excludeText: string;
  limit: number;
}

/** Tailored document returned by the worker and rendered to PDF in the browser. */
export interface TailoredDocument {
  fileName: string;
  name: string;
  contact: string[];
  summary: string;
  education: Array<{ school: string; detail: string; date: string }>;
  skills: Array<{ label: string; items: string[] }>;
  experience: Array<{ company: string; title: string; dates: string; bullets: string[] }>;
  changes: string;
}

/** The account's saved profile document, the source for tailored PDFs and letters. */
export interface ProfileDocument {
  fileName?: string;
  letterFileName?: string;
  name: string;
  contact: string[];
  education: Array<{ school: string; detail: string; date: string }>;
  skills: Array<{ label: string; items: string[] }>;
  experience: Array<{ company: string; title: string; dates: string; bullets: string[] }>;
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
  outreach?: { name: string; background: string[]; links?: string[] };
}

export interface Me {
  username: string;
  hasDocument: boolean;
  hasCriteria: boolean;
}
