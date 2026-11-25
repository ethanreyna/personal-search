import { useEffect, useState, useCallback } from 'react';
import type { Listing, SearchForm } from './types';
import ListingCard from './ListingCard';

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: '', label: 'All' },
];

const DAY_OPTIONS = [1, 2, 3, 7, 14, 30];
const FORM_KEY = 'search-form';

const DEFAULT_FORM: SearchForm = {
  keywords: '',
  location: 'Houston, Texas, United States',
  remoteOnly: false,
  postedWithinDays: 3,
  maxApplicants: 100,
  maxYears: 3,
  excludeTitle: 'senior, sr, lead, principal, staff, manager, director, architect, iii',
  excludeText: '',
  limit: 50,
};

const SOURCES = ['linkedin', 'adzuna', 'jsearch', 'jooble', 'federal', 'greenhouse', 'lever', 'ashby', 'remotive', 'remoteok', 'arbeitnow'];
const SORTS: Array<[string, string]> = [
  ['score', 'Best match'],
  ['newest', 'Newest'],
  ['applicants', 'Fewest applicants'],
  ['years', 'Least experience asked'],
  ['salary', 'Highest salary'],
  ['oldest', 'Oldest'],
  ['company', 'Company A-Z'],
];

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`pref:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(`pref:${key}`, value);
  } catch {
    /* storage unavailable */
  }
}

function loadForm(): SearchForm {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    if (raw) return { ...DEFAULT_FORM, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_FORM;
}

export default function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState('new');
  const [minScore, setMinScore] = useState(0);
  const [source, setSource] = useState(() => readPref('source', ''));
  const [sort, setSort] = useState(() => readPref('sort', 'score'));
  const [englishOnly, setEnglishOnly] = useState(() => readPref('englishOnly', '1') === '1');
  const [onlyWithPoster, setOnlyWithPoster] = useState(false);
  const [hideClosed, setHideClosed] = useState(() => readPref('hideClosed', '1') === '1');
  const [payListed, setPayListed] = useState(() => readPref('payListed', '0') === '1');
  const [form, setForm] = useState<SearchForm>(loadForm);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(form));
    } catch {
      /* storage unavailable */
    }
  }, [form]);

  // Apply the word lists after typing pauses, not on every keystroke.
  const [excludeTitleApplied, setExcludeTitleApplied] = useState(form.excludeTitle);
  const [excludeTextApplied, setExcludeTextApplied] = useState(form.excludeText);
  useEffect(() => {
    const t = setTimeout(() => {
      setExcludeTitleApplied(form.excludeTitle);
      setExcludeTextApplied(form.excludeText);
    }, 400);
    return () => clearTimeout(t);
  }, [form.excludeTitle, form.excludeText]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (minScore) params.set('minScore', String(minScore));
      if (source) params.set('source', source);
      params.set('sort', sort);
      if (englishOnly) params.set('englishOnly', '1');
      if (onlyWithPoster) params.set('hasPoster', '1');
      if (hideClosed) params.set('hideClosed', '1');
      if (payListed) params.set('payListed', '1');
      if (form.maxApplicants !== '') params.set('maxApplicants', String(form.maxApplicants));
      if (form.postedWithinDays) params.set('postedWithinDays', String(form.postedWithinDays));
      if (form.maxYears !== '') params.set('maxYears', String(form.maxYears));
      if (excludeTitleApplied.trim()) params.set('excludeTitle', excludeTitleApplied);
      if (excludeTextApplied.trim()) params.set('excludeText', excludeTextApplied);
      params.set('limit', '200');
      const res = await fetch(`/api/listings?${params.toString()}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setListings((await res.json()) as Listing[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [
    status,
    minScore,
    source,
    sort,
    englishOnly,
    onlyWithPoster,
    hideClosed,
    payListed,
    form.maxApplicants,
    form.postedWithinDays,
    form.maxYears,
    excludeTitleApplied,
    excludeTextApplied,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const setListingStatus = async (id: string, next: string) => {
    setListings((prev) => prev.filter((l) => l.id !== id || status === ''));
    await fetch(`/api/listings/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.keywords.trim()) return;
    setSearching(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: form.keywords,
          location: form.location || undefined,
          remoteOnly: form.remoteOnly,
          postedWithinDays: form.postedWithinDays,
          limit: form.limit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      const counts = Object.entries(data.counts ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
      const errors = Object.entries(data.errors ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ');
      setInfo(
        `Fetched ${data.processed} results (${counts || 'none'}).` +
          (errors ? ` Failed: ${errors}.` : '') +
          ` Filters below are applied to what's shown.`
      );
      setStatus('new');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error || `Sync failed (${res.status})`);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const update = <K extends keyof SearchForm>(k: K, v: SearchForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <header>
        <h1>Listings</h1>
        <button onClick={runSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Run scheduled sync'}
        </button>
      </header>

      <form className="search" onSubmit={runSearch}>
        <div className="row">
          <input
            className="grow"
            placeholder="Keywords, e.g. react typescript frontend"
            value={form.keywords}
            onChange={(e) => update('keywords', e.target.value)}
          />
          <button type="submit" className="active" disabled={searching || !form.keywords.trim()}>
            {searching ? 'Searching… (1–3 min)' : 'Search all sources'}
          </button>
        </div>
        <div className="row">
          <input
            className="grow"
            placeholder="Location (blank = anywhere)"
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
          />
          <label>
            <input type="checkbox" checked={form.remoteOnly} onChange={(e) => update('remoteOnly', e.target.checked)} />
            Remote only
          </label>
        </div>
        <div className="row">
          <label>
            Posted within
            <select value={form.postedWithinDays} onChange={(e) => update('postedWithinDays', Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '24 hours' : `${d} days`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fewer than
            <input
              type="number"
              min={1}
              className="narrow"
              value={form.maxApplicants}
              onChange={(e) => update('maxApplicants', e.target.value === '' ? '' : Number(e.target.value))}
            />
            applicants
          </label>
          <label>
            Asks for at most
            <input
              type="number"
              min={0}
              className="narrow"
              value={form.maxYears}
              onChange={(e) => update('maxYears', e.target.value === '' ? '' : Number(e.target.value))}
            />
            yrs
          </label>
          <label>
            Max results
            <select value={form.limit} onChange={(e) => update('limit', Number(e.target.value))}>
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="grow">
            Hide titles with
            <input
              className="grow"
              placeholder="comma-separated words, e.g. senior, lead"
              value={form.excludeTitle}
              onChange={(e) => update('excludeTitle', e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label className="grow">
            Hide descriptions with
            <input
              className="grow"
              placeholder="comma-separated words or phrases, e.g. clearance, phd, on-call"
              value={form.excludeText}
              onChange={(e) => update('excludeText', e.target.value)}
            />
          </label>
        </div>
      </form>

      <nav className="tabs">
        {STATUS_TABS.map((t) => (
          <button key={t.key} className={status === t.key ? 'active' : ''} onClick={() => setStatus(t.key)}>
            {t.label}
          </button>
        ))}
        <label className="minscore">
          Source
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              writePref('source', e.target.value);
            }}
          >
            <option value="">All</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="minscore">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              writePref('sort', e.target.value);
            }}
          >
            {SORTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={englishOnly}
            onChange={(e) => {
              setEnglishOnly(e.target.checked);
              writePref('englishOnly', e.target.checked ? '1' : '0');
            }}
          />
          English only
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyWithPoster} onChange={(e) => setOnlyWithPoster(e.target.checked)} />
          Has poster
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={(e) => {
              setHideClosed(e.target.checked);
              writePref('hideClosed', e.target.checked ? '1' : '0');
            }}
          />
          Hide closed
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={payListed}
            onChange={(e) => {
              setPayListed(e.target.checked);
              writePref('payListed', e.target.checked ? '1' : '0');
            }}
          />
          Pay listed
        </label>
        <label className="minscore">
          Min match %
          <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
        </label>
      </nav>

      {error && <p className="error">{error}</p>}
      {info && <p className="note">{info}</p>}
      {loading && <p>Loading…</p>}

      <ul className="list">
        {listings.map((l) => (
          <ListingCard key={`${l.id}:${l.fetched_at}`} listing={l} onStatus={setListingStatus} />
        ))}
        {!loading && listings.length === 0 && <p>Nothing here yet.</p>}
      </ul>
    </div>
  );
}
