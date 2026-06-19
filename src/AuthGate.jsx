import React, { useEffect, useState } from 'react';
import { auth } from './api.js';

// Wraps the app in a single-password lock. The real enforcement is server-side
// (the /api gate); this screen is the UX. Once a valid password is stored on the
// device, the app loads straight through — including offline — and the password
// rides along on the online-only API calls.
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('checking'); // 'checking' | 'locked' | 'open'
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.hasStored()) {
      setPhase('open');
      return;
    }
    // No stored password: ask the server whether one is required. If it's
    // unreachable (offline) or none is configured, let the app load.
    auth.status().then((s) => setPhase(s.required ? 'locked' : 'open'));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await auth.signIn(password.trim());
      setPhase('open');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'checking') return null;
  if (phase === 'open') return children;

  return (
    <div className="auth-gate">
      <form className="auth-card" onSubmit={submit}>
        <span className="logo-mark">歌</span>
        <h1>Japp</h1>
        <p className="muted">This app is private. Enter the password to continue.</p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !password.trim()}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
