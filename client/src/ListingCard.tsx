import { useState } from 'react';
import type { Listing, TailoredDocument } from './types';
import { downloadDocument } from './pdf';

interface Props {
  listing: Listing;
  onStatus: (id: string, status: string) => void;
}

const enc = encodeURIComponent;

export default function ListingCard({ listing: initial, onStatus }: Props) {
  const [l, setL] = useState(initial);
  const [busy, setBusy] = useState<'' | 'contact' | 'draft' | 'save' | 'doc'>('');
  const [note, setNote] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(!!initial.draft_body);
  const [copied, setCopied] = useState(false);

  const findEmail = async () => {
    setBusy('contact');
    setNote(null);
    try {
      const res = await fetch(`/api/listings/${enc(l.id)}/contact`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || `Failed (${res.status})`);
      setL({ ...l, contact_email: data.email, contact_status: data.status, contact_score: data.score ?? null });
      if (data.status !== 'found') setNote(data.detail || 'No email found');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setBusy('');
    }
  };

  const writeDraft = async () => {
    setBusy('draft');
    setNote(null);
    try {
      const res = await fetch(`/api/listings/${enc(l.id)}/draft`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setL({ ...l, draft_subject: data.subject, draft_body: data.body });
      setShowDraft(true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Draft failed');
    } finally {
      setBusy('');
    }
  };

  // Generates (or reuses) the tailored document, then downloads the PDF.
  const tailoredPdf = async (redo = false) => {
    setBusy('doc');
    setNote(null);
    try {
      const res = await fetch(`/api/listings/${enc(l.id)}/document${redo ? '?redo=1' : ''}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      const doc = data as TailoredDocument;
      await downloadDocument(doc);
      setL({ ...l, has_document: 1 });
      if (doc.changes) setNote(doc.changes);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'PDF failed');
    } finally {
      setBusy('');
    }
  };

  const saveDraft = async () => {
    setBusy('save');
    try {
      await fetch(`/api/listings/${enc(l.id)}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: l.draft_subject ?? '', body: l.draft_body ?? '' }),
      });
    } finally {
      setBusy('');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${l.draft_subject ?? ''}\n\n${l.draft_body ?? ''}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote('Clipboard not available');
    }
  };

  const mailto = l.contact_email
    ? `mailto:${l.contact_email}?subject=${enc(l.draft_subject ?? '')}&body=${enc(l.draft_body ?? '')}`
    : undefined;

  return (
    <li className="card">
      <div className="card-main">
        <a href={l.url} target="_blank" rel="noreferrer" className="title">
          {l.title}
        </a>
        <span className={`score ${l.score >= 70 ? 'high' : l.score >= 45 ? 'mid' : 'low'}`} title="Match %">
          {l.score}%
        </span>
      </div>
      {l.match_notes && <div className="match-notes">{l.match_notes}</div>}
      <div className="meta">
        {l.company && <span>{l.company}</span>}
        {l.location && <span>{l.location}</span>}
        {!!l.remote && <span className="tag">remote</span>}
        <span className="tag source">{l.source}</span>
        {l.posted_at && <span>{new Date(l.posted_at).toLocaleDateString()}</span>}
        {l.applicants !== null && (
          <span className={l.applicants < 100 ? 'tag good' : 'tag warn'}>{l.applicants} applicants</span>
        )}
        {l.min_years !== null && l.min_years !== undefined && (
          <span className="tag" title="Minimum experience stated in the description">
            {l.min_years}+ yrs
          </span>
        )}
      </div>

      {(l.poster_name || l.poster_url) && (
        <div className="poster">
          Posted by{' '}
          {l.poster_url ? (
            <a href={l.poster_url} target="_blank" rel="noreferrer">
              {l.poster_name || 'profile'}
            </a>
          ) : (
            l.poster_name
          )}
          {l.poster_title && <span className="muted"> · {l.poster_title}</span>}
          {l.contact_email && (
            <>
              {' · '}
              <a href={`mailto:${l.contact_email}`}>{l.contact_email}</a>
              {l.contact_score !== null && (
                <span className={l.contact_score >= 70 ? 'tag good' : 'tag warn'} title="Hunter confidence">
                  {' '}
                  {l.contact_score}%
                </span>
              )}
            </>
          )}
          {l.contact_status === 'not_found' && <span className="muted"> · no email found</span>}
        </div>
      )}

      <div className="actions">
        {l.poster_url && !l.contact_email && l.contact_status !== 'not_found' && (
          <button onClick={findEmail} disabled={!!busy}>
            {busy === 'contact' ? 'Looking up…' : 'Find email'}
          </button>
        )}
        <button onClick={writeDraft} disabled={!!busy}>
          {busy === 'draft' ? 'Writing…' : l.draft_body ? 'Redo draft' : 'Draft email'}
        </button>
        {l.draft_body && !showDraft && <button onClick={() => setShowDraft(true)}>Show draft</button>}
        <button onClick={() => tailoredPdf(false)} disabled={!!busy} title="Tailor to this listing and download">
          {busy === 'doc' ? 'Tailoring…' : l.has_document ? 'Download PDF' : 'Tailored PDF'}
        </button>
        {!!l.has_document && (
          <button onClick={() => tailoredPdf(true)} disabled={!!busy} title="Generate a new version">
            Redo PDF
          </button>
        )}
        <span className="spacer" />
        {l.status !== 'saved' && <button onClick={() => onStatus(l.id, 'saved')}>Save</button>}
        {l.status !== 'applied' && <button onClick={() => onStatus(l.id, 'applied')}>Applied</button>}
        {l.status !== 'dismissed' && <button onClick={() => onStatus(l.id, 'dismissed')}>Dismiss</button>}
        {l.status !== 'new' && <button onClick={() => onStatus(l.id, 'new')}>Reset</button>}
      </div>

      {note && <p className="note">{note}</p>}

      {showDraft && l.draft_body !== null && (
        <div className="draft">
          <input
            value={l.draft_subject ?? ''}
            onChange={(e) => setL({ ...l, draft_subject: e.target.value })}
            onBlur={saveDraft}
            placeholder="Subject"
          />
          <textarea
            rows={9}
            value={l.draft_body ?? ''}
            onChange={(e) => setL({ ...l, draft_body: e.target.value })}
            onBlur={saveDraft}
          />
          <div className="actions">
            <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            {mailto && (
              <a className="button" href={mailto}>
                Open in mail app
              </a>
            )}
            <button onClick={() => setShowDraft(false)}>Hide</button>
            {busy === 'save' && <span className="muted">Saving…</span>}
          </div>
        </div>
      )}
    </li>
  );
}
