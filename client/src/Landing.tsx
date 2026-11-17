import { useState } from 'react';
import { api } from './api';

export default function Landing({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') await api('/api/auth/login', { body: { username, password } });
      else await api('/api/auth/signup', { body: { username, password, invite } });
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="landing-intro">
        <h1>Personal search</h1>
        <p className="muted">
          Pulls listings from several sources, scores each one against your criteria, and writes a tailored
          version of your profile document and a short letter for any listing or description you paste in.
        </p>
      </div>

      <form className="panel auth" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')}>
            Sign in
          </button>
          <button type="button" className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')}>
            Create account
          </button>
        </div>
        <label className="field">
          Username
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            minLength={mode === 'up' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {mode === 'up' && (
          <label className="field">
            Invite code
            <input value={invite} onChange={(e) => setInvite(e.target.value)} required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="active" disabled={busy}>
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
