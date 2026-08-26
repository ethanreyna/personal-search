import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Listing } from './types';

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: '', label: 'All' },
];

export default function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState('new');
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (minScore) params.set('minScore', String(minScore));
      params.set('limit', '200');
      const res = await fetch(`/api/listings?${params.toString()}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as Listing[];
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [status, minScore]);

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

  const runSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const sorted = useMemo(
    () => [...listings].sort((a, b) => b.score - a.score),
    [listings]
  );

  return (
    <div className="wrap">
      <header>
        <h1>Dashboard</h1>
        <button onClick={runSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </header>

      <nav className="tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            className={status === t.key ? 'active' : ''}
            onClick={() => setStatus(t.key)}
          >
            {t.label}
          </button>
        ))}
        <label className="minscore">
          Min score
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
          />
        </label>
      </nav>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      <ul className="list">
        {sorted.map((l) => (
          <li key={l.id} className="card">
            <div className="card-main">
              <a href={l.url} target="_blank" rel="noreferrer" className="title">
                {l.title}
              </a>
              <span className="score">{l.score}</span>
            </div>
            <div className="meta">
              {l.company && <span>{l.company}</span>}
              {l.location && <span>{l.location}</span>}
              {!!l.remote && <span className="tag">remote</span>}
              <span className="tag source">{l.source}</span>
              {l.posted_at && <span>{new Date(l.posted_at).toLocaleDateString()}</span>}
            </div>
            <div className="actions">
              {l.status !== 'saved' && (
                <button onClick={() => setListingStatus(l.id, 'saved')}>Save</button>
              )}
              {l.status !== 'applied' && (
                <button onClick={() => setListingStatus(l.id, 'applied')}>Applied</button>
              )}
              {l.status !== 'dismissed' && (
                <button onClick={() => setListingStatus(l.id, 'dismissed')}>Dismiss</button>
              )}
              {l.status !== 'new' && (
                <button onClick={() => setListingStatus(l.id, 'new')}>Reset</button>
              )}
            </div>
          </li>
        ))}
        {!loading && sorted.length === 0 && <p>Nothing here yet.</p>}
      </ul>
    </div>
  );
}
