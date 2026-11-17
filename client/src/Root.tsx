import { useCallback, useEffect, useState } from 'react';
import { api, watchSession } from './api';
import type { Me } from './types';
import Landing from './Landing';
import App from './App';
import Personalize from './Personalize';
import Profile from './Profile';

const PAGES = [
  ['listings', 'Listings'],
  ['personalize', 'Personalize'],
  ['profile', 'Profile'],
] as const;
type Page = (typeof PAGES)[number][0];

const pageFromHash = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (PAGES.find(([k]) => k === h)?.[0] ?? 'listings') as Page;
};

export default function Root() {
  // undefined = still checking, null = signed out
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [page, setPage] = useState<Page>(pageFromHash);

  const refresh = useCallback(() => {
    api<Me>('/api/auth/me').then(setMe, () => setMe(null));
  }, []);

  useEffect(refresh, [refresh]);
  useEffect(() => watchSession(() => setMe(null)), []);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  };

  if (me === undefined) return null;
  if (me === null) return <Landing onSignedIn={refresh} />;

  return (
    <>
      <nav className="topbar">
        <div className="topbar-inner">
          <strong>Personal search</strong>
          {PAGES.map(([key, label]) => (
            <a key={key} href={`#/${key}`} className={page === key ? 'active' : ''}>
              {label}
            </a>
          ))}
          <span className="spacer" />
          <span className="muted small">{me.username}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <div className="wrap">
        {(!me.hasDocument || !me.hasCriteria) && page !== 'profile' && (
          <p className="banner">
            {!me.hasDocument && !me.hasCriteria
              ? 'Set up your profile document and criteria to get tailored PDFs, letters and match scores.'
              : !me.hasDocument
                ? 'Add your profile document to get tailored PDFs and letters.'
                : 'Save your criteria to get match scores and the scheduled sync.'}{' '}
            <a href="#/profile">Go to Profile</a>
          </p>
        )}
        {page === 'listings' && <App />}
        {page === 'personalize' && <Personalize hasDocument={me.hasDocument} />}
        {page === 'profile' && <Profile onSaved={refresh} />}
      </div>
    </>
  );
}
