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
}
