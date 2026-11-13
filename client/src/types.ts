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
