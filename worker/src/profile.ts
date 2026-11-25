import type { Criteria, ProfileDocument } from './sources/types';

// Input from the profile forms is checked and trimmed here before it's saved.

const text = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const texts = (v: unknown, max = 600, count = 60) =>
  (Array.isArray(v) ? v : []).map((s) => text(s, max)).filter(Boolean).slice(0, count);
const list = <T>(v: unknown, f: (x: any) => T | null, count = 30): T[] =>
  (Array.isArray(v) ? v : []).map(f).filter((x): x is T => x !== null).slice(0, count);

export function cleanDocument(x: any): ProfileDocument {
  const name = text(x?.name, 120);
  if (!name) throw new Error('Name is required');
  const experience = list(x?.experience, (e) => {
    const company = text(e?.company, 160);
    if (!company) return null;
    return { company, title: text(e?.title, 160), dates: text(e?.dates, 80), bullets: texts(e?.bullets, 500, 15) };
  });
  if (!experience.length) throw new Error('Add at least one role under experience');
  return {
    fileName: text(x?.fileName, 120) || `${name}.pdf`,
    letterFileName: text(x?.letterFileName, 120) || `${name} Letter.pdf`,
    name,
    contact: texts(x?.contact, 200, 8),
    education: list(x?.education, (e) => {
      const school = text(e?.school, 160);
      return school ? { school, detail: text(e?.detail, 200), date: text(e?.date, 60) } : null;
    }),
    skills: list(x?.skills, (g) => {
      const items = texts(g?.items, 80, 60);
      return items.length ? { label: text(g?.label, 60) || 'Skills', items } : null;
    }),
    experience,
    extraFacts: texts(x?.extraFacts, 400, 15),
  };
}

export function cleanCriteria(x: any): Criteria {
  const titles = texts(x?.titles, 100, 20);
  if (!titles.length) throw new Error('Add at least one title');
  const years = Number(x?.targetYearsExperience);
  const links = texts(x?.outreach?.links, 200, 5);
  const background = texts(x?.outreach?.background, 400, 12);
  const outreachName = text(x?.outreach?.name, 120);
  return {
    titles,
    skills: texts(x?.skills, 60, 80),
    mustHaveAnySkills: texts(x?.mustHaveAnySkills, 60, 10),
    locations: texts(x?.locations, 100, 10),
    remoteOk: x?.remoteOk !== false,
    excludeKeywords: texts(x?.excludeKeywords, 60, 30),
    targetYearsExperience: Number.isFinite(years) ? Math.max(0, Math.min(40, Math.round(years))) : 3,
    ...(Number(x?.minSalary) > 0 ? { minSalary: Math.min(2_000_000, Math.round(Number(x.minSalary))) } : {}),
    disabledSources: texts(x?.disabledSources, 30, 20),
    boards: texts(x?.boards, 80, 20).map((b) => b.toLowerCase().replace(/\s+/g, '')),
    ...(outreachName || background.length ? { outreach: { name: outreachName, background, links } } : {}),
  };
}
