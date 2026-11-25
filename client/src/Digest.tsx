import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Listing } from './types';
import ListingCard from './ListingCard';

interface DigestData {
  from: string;
  to: string;
  stats: { found: number; unique: number; matching: number; confirmedOpen: number; closed: number };
  lastRun: { at: string; ok: string[]; failed: string[] } | null;
  top: Listing[];
  second: Listing[];
}

const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function Digest() {
  const [data, setData] = useState<DigestData | null>(null);
  const [builtAt, setBuiltAt] = useState<Date | null>(null);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<DigestData>(`/api/digest?days=${days}`));
      setBuiltAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  // Runs a sync for this account first, so the digest includes anything posted since the last one.
  const buildNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/sync', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: string) => {
    await api(`/api/listings/${encodeURIComponent(id)}/status`, { body: { status } });
    load();
  };

  const s = data?.stats;
  const run = data?.lastRun;
  const sourcesTotal = run ? run.ok.length + run.failed.length : 0;

  return (
    <div>
      <header>
        <div>
          <h1>Digest</h1>
          {data && (
            <p className="muted small">
              First seen from <strong>{day(data.from)}</strong> to <strong>{day(data.to)}</strong>
              {builtAt && <> · put together {builtAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</>}
            </p>
          )}
        </div>
        <div className="row-edit">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                Last {d === 1 ? 'day' : `${d} days`}
              </option>
            ))}
          </select>
          <button onClick={buildNow} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync and rebuild now'}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Loading…</p>}

      {data && s && (
        <>
          <section className="panel">
            <h2>In numbers</h2>
            <div className="stats">
              <div className="stat">
                <strong>{s.found}</strong>
                <span>postings found</span>
              </div>
              <div className="stat">
                <strong>{s.unique}</strong>
                <span>after removing repeats across sources</span>
              </div>
              <div className="stat">
                <strong>{s.matching}</strong>
                <span>match your profile</span>
              </div>
              <div className="stat">
                <strong>{s.confirmedOpen}</strong>
                <span>confirmed still open{s.closed ? ` (${s.closed} closed)` : ''}</span>
              </div>
              <div className="stat">
                <strong>{run ? `${run.ok.length} of ${sourcesTotal}` : '–'}</strong>
                <span>
                  sources without problems on the last sync
                  {run?.failed.length ? ` (failed: ${run.failed.join(', ')})` : ''}
                </span>
              </div>
            </div>
            <p className="muted small">
              Only the sources turned on in your Profile are searched, so this doesn't cover every posting out there.
            </p>
          </section>

          <div className="section-head">
            <h2>Top new</h2>
            <span className="muted small">{data.top.length}</span>
          </div>
          <p className="muted small">Clear title match, pay listed, nothing flagged.</p>
          <ul className="list">
            {data.top.map((l) => (
              <ListingCard key={`${l.id}:${l.fetched_at}`} listing={l} onStatus={setStatus} />
            ))}
            {data.top.length === 0 && <p className="muted">Nothing in this window yet.</p>}
          </ul>

          <div className="section-head">
            <h2>Worth a second look</h2>
            <span className="muted small">{data.second.length}</span>
          </div>
          <p className="muted small">
            Pay not listed, a requirement to check, or a title only close to yours. Not rejected, they need your judgement.
          </p>
          <ul className="list">
            {data.second.map((l) => (
              <ListingCard key={`${l.id}:${l.fetched_at}`} listing={l} onStatus={setStatus} />
            ))}
            {data.second.length === 0 && <p className="muted">Nothing in this window yet.</p>}
          </ul>
        </>
      )}
    </div>
  );
}
