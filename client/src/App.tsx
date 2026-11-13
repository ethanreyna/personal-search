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
  limit: 50,
};

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
  const [onlySearchResults, setOnlySearchResults] = useState(true);
  const [onlyWithPoster, setOnlyWithPoster] = useState(false);
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

  // Apply the title word list after typing pauses, not on every keystroke.
  const [excludeTitleApplied, setExcludeTitleApplied] = useState(form.excludeTitle);
  useEffect(() => {
    const t = setTimeout(() => setExcludeTitleApplied(form.excludeTitle), 400);
    return () => clearTimeout(t);
  }, [form.excludeTitle]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (minScore) params.set('minScore', String(minScore));
      if (onlySearchResults) params.set('source', 'linkedin');
      if (onlyWithPoster) params.set('hasPoster', '1');
      if (form.maxApplicants !== '') params.set('maxApplicants', String(form.maxApplicants));
      if (form.postedWithinDays) params.set('postedWithinDays', String(form.postedWithinDays));
      if (form.maxYears !== '') params.set('maxYears', String(form.maxYears));
      if (excludeTitleApplied.trim()) params.set('excludeTitle', excludeTitleApplied);
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
    onlySearchResults,
    onlyWithPoster,
    form.maxApplicants,
    form.postedWithinDays,
    form.maxYears,
    excludeTitleApplied,
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
      setInfo(`Fetched ${data.processed} results. Filters below are applied to what's shown.`);
      setOnlySearchResults(true);
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
      await fetch('/api/sync', { method: 'POST' });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const update = <K extends keyof SearchForm>(k: K, v: SearchForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="wrap">
      <header>
        <h1>Dashboard</h1>
        <button onClick={runSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync other sources'}
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
            {searching ? 'Searching… (1–3 min)' : 'Search LinkedIn'}
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
      </form>

      <nav className="tabs">
        {STATUS_TABS.map((t) => (
          <button key={t.key} className={status === t.key ? 'active' : ''} onClick={() => setStatus(t.key)}>
            {t.label}
          </button>
        ))}
        <label className="toggle">
          <input type="checkbox" checked={onlySearchResults} onChange={(e) => setOnlySearchResults(e.target.checked)} />
          LinkedIn only
        </label>
        <label className="toggle">
          <input type="checkbox" checked={onlyWithPoster} onChange={(e) => setOnlyWithPoster(e.target.checked)} />
          Has poster
        </label>
        <label className="minscore">
          Min score
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
