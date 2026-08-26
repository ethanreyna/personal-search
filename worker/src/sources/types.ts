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
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_PASSWORD: string;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  RAPIDAPI_KEY?: string;
}
