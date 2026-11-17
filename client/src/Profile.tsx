import { useEffect, useState } from 'react';
import { api } from './api';
import type { Criteria, ProfileDocument } from './types';

// Forms keep lists as plain text (one per line, or comma separated) and convert on save.
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

interface DocForm {
  name: string;
  fileName: string;
  letterFileName: string;
  contact: string;
  education: Array<{ school: string; detail: string; date: string }>;
  skills: Array<{ label: string; items: string }>;
  experience: Array<{ company: string; title: string; dates: string; bullets: string }>;
  extraFacts: string;
}

interface CriteriaForm {
  titles: string;
  skills: string;
  mustHaveAnySkills: string;
  locations: string;
  remoteOk: boolean;
  excludeKeywords: string;
  targetYearsExperience: string;
  outreachName: string;
  background: string;
  links: string;
}

const EMPTY_DOC: DocForm = {
  name: '',
  fileName: '',
  letterFileName: '',
  contact: '',
  education: [{ school: '', detail: '', date: '' }],
  skills: [{ label: 'Skills', items: '' }],
  experience: [{ company: '', title: '', dates: '', bullets: '' }],
  extraFacts: '',
};

function toDocForm(d: ProfileDocument | null): DocForm {
  if (!d) return EMPTY_DOC;
  return {
    name: d.name,
    fileName: d.fileName ?? '',
    letterFileName: d.letterFileName ?? '',
    contact: d.contact.join('\n'),
    education: d.education.length ? d.education : EMPTY_DOC.education,
    skills: d.skills.map((g) => ({ label: g.label, items: g.items.join(', ') })),
    experience: d.experience.map((e) => ({ ...e, bullets: e.bullets.join('\n') })),
    extraFacts: (d.extraFacts ?? []).join('\n'),
  };
}

function fromDocForm(f: DocForm): ProfileDocument {
  return {
    name: f.name,
    fileName: f.fileName,
    letterFileName: f.letterFileName,
    contact: lines(f.contact),
    education: f.education,
    skills: f.skills.map((g) => ({ label: g.label, items: commas(g.items) })),
    experience: f.experience.map((e) => ({ ...e, bullets: lines(e.bullets) })),
    extraFacts: lines(f.extraFacts),
  };
}

function toCriteriaForm(c: Criteria | null): CriteriaForm {
  return {
    titles: (c?.titles ?? []).join(', '),
    skills: (c?.skills ?? []).join(', '),
    mustHaveAnySkills: (c?.mustHaveAnySkills ?? []).join(', '),
    locations: (c?.locations ?? ['Remote']).join(', '),
    remoteOk: c?.remoteOk ?? true,
    excludeKeywords: (c?.excludeKeywords ?? []).join(', '),
    targetYearsExperience: String(c?.targetYearsExperience ?? 3),
    outreachName: c?.outreach?.name ?? '',
    background: (c?.outreach?.background ?? []).join('\n'),
    links: (c?.outreach?.links ?? []).join('\n'),
  };
}

function fromCriteriaForm(f: CriteriaForm): Criteria {
  return {
    titles: commas(f.titles),
    skills: commas(f.skills),
    mustHaveAnySkills: commas(f.mustHaveAnySkills),
    locations: commas(f.locations),
    remoteOk: f.remoteOk,
    excludeKeywords: commas(f.excludeKeywords),
    targetYearsExperience: Number(f.targetYearsExperience) || 0,
    outreach: { name: f.outreachName, background: lines(f.background), links: lines(f.links) },
  };
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}

export default function Profile({ onSaved }: { onSaved: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [doc, setDoc] = useState<DocForm>(EMPTY_DOC);
  const [crit, setCrit] = useState<CriteriaForm>(toCriteriaForm(null));
  const [busy, setBusy] = useState<'' | 'import' | 'doc' | 'crit' | 'pw'>('');
  const [msg, setMsg] = useState<{ where: string; text: string; error?: boolean } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });

  useEffect(() => {
    api<{ document: ProfileDocument | null; criteria: Criteria | null }>('/api/profile')
      .then((p) => {
        setDoc(toDocForm(p.document));
        setCrit(toCriteriaForm(p.criteria));
      })
      .catch((err) => setMsg({ where: 'top', text: err.message, error: true }))
      .finally(() => setLoaded(true));
  }, []);

  const run = async (kind: typeof busy, where: string, fn: () => Promise<string>) => {
    setBusy(kind);
    setMsg(null);
    try {
      setMsg({ where, text: await fn() });
    } catch (err) {
      setMsg({ where, text: err instanceof Error ? err.message : 'Failed', error: true });
    } finally {
      setBusy('');
    }
  };

  const importPdf = (file: File | undefined) =>
    file &&
    run('import', 'top', async () => {
      const data = await readBase64(file);
      const r = await api<{ document: ProfileDocument; criteria: Criteria }>('/api/profile/import', { body: { data } });
      setDoc(toDocForm(r.document));
      setCrit(toCriteriaForm(r.criteria));
      return 'Read the file. Check both sections below, then save each one.';
    });

  const saveDoc = () =>
    run('doc', 'doc', async () => {
      const saved = await api<ProfileDocument>('/api/profile/document', { method: 'PUT', body: fromDocForm(doc) });
      setDoc(toDocForm(saved));
      onSaved();
      return 'Saved. New tailored PDFs and letters will use this version.';
    });

  const saveCrit = () =>
    run('crit', 'crit', async () => {
      const saved = await api<Criteria>('/api/profile/criteria', { method: 'PUT', body: fromCriteriaForm(crit) });
      setCrit(toCriteriaForm(saved));
      onSaved();
      return 'Saved. Match scores update the next time you open Listings.';
    });

  const changePassword = () =>
    run('pw', 'pw', async () => {
      await api('/api/auth/password', { method: 'PUT', body: pw });
      setPw({ current: '', next: '' });
      return 'Password changed.';
    });

  const note = (where: string) =>
    msg?.where === where && <p className={msg.error ? 'error' : 'note'}>{msg.text}</p>;

  const setRow = <K extends 'education' | 'skills' | 'experience'>(key: K, i: number, patch: Partial<DocForm[K][number]>) =>
    setDoc((d) => ({ ...d, [key]: d[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = <K extends 'education' | 'skills' | 'experience'>(key: K) =>
    setDoc((d) => ({ ...d, [key]: [...d[key], EMPTY_DOC[key][0]] }));
  const removeRow = (key: 'education' | 'skills' | 'experience', i: number) =>
    setDoc((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));

  if (!loaded) return <p>Loading…</p>;

  return (
    <div className="stack">
      <section className="panel">
        <h2>Start from a PDF</h2>
        <p className="muted">
          Upload your current document and the fields below are filled in from it, along with suggested criteria.
          Nothing is saved until you press Save.
        </p>
        <label className="button file">
          {busy === 'import' ? 'Reading… (up to a minute)' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf"
            disabled={!!busy}
            onChange={(e) => {
              importPdf(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {note('top')}
      </section>

      <section className="panel">
        <h2>Profile document</h2>
        <p className="muted">Tailored PDFs and letters only use what's here.</p>
        <div className="grid2">
          <label className="field">
            Name
            <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
          </label>
          <label className="field">
            Contact lines (one per line)
            <textarea rows={3} value={doc.contact} onChange={(e) => setDoc({ ...doc, contact: e.target.value })} />
          </label>
          <label className="field">
            PDF file name
            <input
              placeholder={`${doc.name || 'Name'}.pdf`}
              value={doc.fileName}
              onChange={(e) => setDoc({ ...doc, fileName: e.target.value })}
            />
          </label>
          <label className="field">
            Letter file name
            <input
              placeholder={`${doc.name || 'Name'} Letter.pdf`}
              value={doc.letterFileName}
              onChange={(e) => setDoc({ ...doc, letterFileName: e.target.value })}
            />
          </label>
        </div>
        <p className="muted small">The organization's name is added to the end of both file names when you download.</p>

        <h3>Education</h3>
        {doc.education.map((e, i) => (
          <div className="row-edit" key={i}>
            <input placeholder="School" value={e.school} onChange={(ev) => setRow('education', i, { school: ev.target.value })} />
            <input placeholder="Degree, field" value={e.detail} onChange={(ev) => setRow('education', i, { detail: ev.target.value })} />
            <input placeholder="Date" className="short" value={e.date} onChange={(ev) => setRow('education', i, { date: ev.target.value })} />
            <button type="button" onClick={() => removeRow('education', i)} title="Remove">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => addRow('education')}>Add education</button>

        <h3>Skills</h3>
        {doc.skills.map((g, i) => (
          <div className="row-edit" key={i}>
            <input placeholder="Group" className="short" value={g.label} onChange={(ev) => setRow('skills', i, { label: ev.target.value })} />
            <input placeholder="Comma separated" className="grow" value={g.items} onChange={(ev) => setRow('skills', i, { items: ev.target.value })} />
            <button type="button" onClick={() => removeRow('skills', i)} title="Remove">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => addRow('skills')}>Add skill group</button>

        <h3>Experience</h3>
        {doc.experience.map((e, i) => (
          <div className="entry" key={i}>
            <div className="row-edit">
              <input placeholder="Organization" value={e.company} onChange={(ev) => setRow('experience', i, { company: ev.target.value })} />
              <input placeholder="Title" value={e.title} onChange={(ev) => setRow('experience', i, { title: ev.target.value })} />
              <input placeholder="Dates" className="short" value={e.dates} onChange={(ev) => setRow('experience', i, { dates: ev.target.value })} />
              <button type="button" onClick={() => removeRow('experience', i)} title="Remove">✕</button>
            </div>
            <textarea
              rows={5}
              placeholder="One bullet per line"
              value={e.bullets}
              onChange={(ev) => setRow('experience', i, { bullets: ev.target.value })}
            />
          </div>
        ))}
        <button type="button" onClick={() => addRow('experience')}>Add role</button>

        <h3>Other facts</h3>
        <label className="field">
          True statements not tied to one role (projects, certifications). One per line.
          <textarea rows={3} value={doc.extraFacts} onChange={(e) => setDoc({ ...doc, extraFacts: e.target.value })} />
        </label>

        <div className="actions">
          <button className="active" onClick={saveDoc} disabled={!!busy}>
            {busy === 'doc' ? 'Saving…' : 'Save document'}
          </button>
        </div>
        {note('doc')}
      </section>

      <section className="panel">
        <h2>Criteria</h2>
        <p className="muted">Used for the scheduled sync and the match %.</p>
        <div className="grid2">
          <label className="field">
            Titles (comma separated; the first one drives the scheduled sync)
            <input value={crit.titles} onChange={(e) => setCrit({ ...crit, titles: e.target.value })} />
          </label>
          <label className="field">
            Locations
            <input value={crit.locations} onChange={(e) => setCrit({ ...crit, locations: e.target.value })} />
          </label>
          <label className="field">
            Skills you have
            <textarea rows={3} value={crit.skills} onChange={(e) => setCrit({ ...crit, skills: e.target.value })} />
          </label>
          <label className="field">
            Core stack (a listing naming any of these scores higher)
            <textarea rows={3} value={crit.mustHaveAnySkills} onChange={(e) => setCrit({ ...crit, mustHaveAnySkills: e.target.value })} />
          </label>
          <label className="field">
            Years of experience
            <input type="number" min={0} value={crit.targetYearsExperience} onChange={(e) => setCrit({ ...crit, targetYearsExperience: e.target.value })} />
          </label>
          <label className="field">
            Lower the score when the text mentions
            <input value={crit.excludeKeywords} onChange={(e) => setCrit({ ...crit, excludeKeywords: e.target.value })} />
          </label>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={crit.remoteOk} onChange={(e) => setCrit({ ...crit, remoteOk: e.target.checked })} />
          Remote is fine
        </label>

        <h3>For emails and letters</h3>
        <div className="grid2">
          <label className="field">
            Sign-off name
            <input value={crit.outreachName} onChange={(e) => setCrit({ ...crit, outreachName: e.target.value })} />
          </label>
          <label className="field">
            Links under the signature (one per line)
            <textarea rows={2} value={crit.links} onChange={(e) => setCrit({ ...crit, links: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Background notes: short, specific, true facts the writer can use. One per line.
          <textarea rows={5} value={crit.background} onChange={(e) => setCrit({ ...crit, background: e.target.value })} />
        </label>

        <div className="actions">
          <button className="active" onClick={saveCrit} disabled={!!busy}>
            {busy === 'crit' ? 'Saving…' : 'Save criteria'}
          </button>
        </div>
        {note('crit')}
      </section>

      <section className="panel">
        <h2>Password</h2>
        <div className="row-edit">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password (8+ characters)"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
          />
          <button onClick={changePassword} disabled={!!busy || !pw.current || pw.next.length < 8}>
            {busy === 'pw' ? 'Saving…' : 'Change'}
          </button>
        </div>
        {note('pw')}
      </section>
    </div>
  );
}
