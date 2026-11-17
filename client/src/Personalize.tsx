import { useCallback, useEffect, useState } from 'react';
import { api, getDocument, getLetter, saveLetter } from './api';
import { downloadDocument, type LetterContent } from './pdf';
import type { TailoredDocument } from './types';
import LetterPanel from './LetterPanel';

interface Item {
  id: number;
  title: string;
  company: string | null;
  created_at: string;
  has_document: number;
  has_letter: number;
}

interface Detail {
  id: number;
  title: string;
  company: string | null;
  description: string;
  document: TailoredDocument | null;
}

// Items already generated in this page load, so a re-mounted panel doesn't start a second generation.
const started = new Set<number>();

/** One personalization: its tailored PDF and letter. */
function Result({ item, onChanged }: { item: Detail; onChanged: () => void }) {
  const base = `/api/personalize/${item.id}`;
  const [doc, setDoc] = useState<TailoredDocument | null>(item.document);
  const [letter, setLetter] = useState<LetterContent | null>(null);
  const [busy, setBusy] = useState<{ doc?: boolean; letter?: boolean }>({});
  const [errors, setErrors] = useState<{ doc?: string; letter?: string }>({});

  const makeDoc = useCallback(
    async (redo: boolean, download: boolean) => {
      setBusy((b) => ({ ...b, doc: true }));
      setErrors((e) => ({ ...e, doc: undefined }));
      try {
        const d = await getDocument(base, redo);
        setDoc(d);
        if (download) await downloadDocument(d, item.company);
      } catch (err) {
        setErrors((e) => ({ ...e, doc: err instanceof Error ? err.message : 'Failed' }));
      } finally {
        setBusy((b) => ({ ...b, doc: false }));
      }
    },
    [base, item.company]
  );

  const makeLetter = useCallback(
    async (redo: boolean) => {
      setBusy((b) => ({ ...b, letter: true }));
      setErrors((e) => ({ ...e, letter: undefined }));
      try {
        setLetter(await getLetter(base, redo));
      } catch (err) {
        setErrors((e) => ({ ...e, letter: err instanceof Error ? err.message : 'Failed' }));
      } finally {
        setBusy((b) => ({ ...b, letter: false }));
      }
    },
    [base]
  );

  // A new item generates both right away (the PDF downloads when ready); a saved one just loads its letter.
  useEffect(() => {
    const fresh = !item.document && !started.has(item.id);
    started.add(item.id);
    Promise.all([fresh ? makeDoc(false, true) : null, makeLetter(false)]).then(() => fresh && onChanged());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="panel">
      <h2>
        {item.title}
        {item.company && <span className="muted"> · {item.company}</span>}
      </h2>

      <h3>Tailored PDF</h3>
      {busy.doc ? (
        <p className="muted">Tailoring your document… (about 30 seconds)</p>
      ) : (
        doc && (
          <>
            {doc.changes && <p className="note">{doc.changes}</p>}
            <div className="actions">
              <button onClick={() => downloadDocument(doc, item.company)}>Download PDF</button>
              <button onClick={() => makeDoc(true, true)}>Redo PDF</button>
            </div>
          </>
        )
      )}
      {errors.doc && (
        <p className="error">
          {errors.doc} <button onClick={() => makeDoc(false, true)}>Try again</button>
        </p>
      )}

      <h3>Letter</h3>
      {busy.letter && !letter && <p className="muted">Writing the letter… (about 30 seconds)</p>}
      {letter && (
        <LetterPanel
          letter={letter}
          organization={item.company}
          onChange={setLetter}
          onSave={() => saveLetter(base, letter.body)}
          onRedo={() => makeLetter(true)}
          redoing={!!busy.letter}
        />
      )}
      {errors.letter && (
        <p className="error">
          {errors.letter} <button onClick={() => makeLetter(false)}>Try again</button>
        </p>
      )}

      <details className="source-text">
        <summary>Description used</summary>
        <p>{item.description}</p>
      </details>
    </div>
  );
}

export default function Personalize({ hasDocument }: { hasDocument: boolean }) {
  const [form, setForm] = useState({ title: '', company: '', description: '' });
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(() => {
    api<Item[]>('/api/personalize').then(setItems).catch((err) => setError(err.message));
  }, []);
  useEffect(loadList, [loadList]);

  const open = async (id: number) => {
    setError(null);
    try {
      setCurrent(await api<Detail>(`/api/personalize/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>('/api/personalize', { body: form });
      setCurrent({ id, title: form.title.trim(), company: form.company.trim() || null, description: form.description, document: null });
      setForm({ title: '', company: '', description: '' });
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await api(`/api/personalize/${id}`, { method: 'DELETE' });
    if (current?.id === id) setCurrent(null);
    loadList();
  };

  return (
    <div className="stack">
      <form className="panel" onSubmit={create}>
        <h2>Personalize</h2>
        <p className="muted">
          Paste any role's title and description to get a version of your profile document and a short letter written
          for it.
        </p>
        {!hasDocument && (
          <p className="error">
            Add your profile document on the <a href="#/profile">Profile</a> page first.
          </p>
        )}
        <div className="grid2">
          <label className="field">
            Title
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="field">
            Organization (optional, used in file names)
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Description
          <textarea
            required
            rows={10}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" className="active" disabled={busy || !hasDocument}>
            {busy ? 'Starting…' : 'Create PDF and letter'}
          </button>
        </div>
      </form>

      {current && <Result key={current.id} item={current} onChanged={loadList} />}

      {items.length > 0 && (
        <section className="panel">
          <h2>Earlier</h2>
          <ul className="plain-list">
            {items.map((i) => (
              <li key={i.id} className={current?.id === i.id ? 'selected' : ''}>
                <button className="link" onClick={() => open(i.id)}>
                  {i.title}
                  {i.company && <span className="muted"> · {i.company}</span>}
                </button>
                <span className="muted small">{new Date(i.created_at).toLocaleDateString()}</span>
                <button onClick={() => remove(i.id)} title="Delete">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
