import React, { useEffect, useState } from 'react';
import { auth } from './api.js';

// Lock screen: asks for a user ID (used to back up the library per user) and,
// when the server requires it, the app password. The user ID is stored on the
// device; real per-user auth replaces this later.
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('checking'); // 'checking' | 'locked' | 'open'
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Straight through when this device already knows the user (and the
    // password, if the server enforces one).
    if (auth.hasUserId()) {
      if (auth.hasPassword()) {
        setPhase('open');
        return;
      }
      auth.status().then((s) => {
        if (s.required) {
          setRequiresPassword(true);
          setPhase('locked');
        } else {
          setPhase('open');
        }
      });
      return;
    }
    // First run: always ask for a user ID (needed for the backup). The
    // password is only required when the server has one configured; offline,
    // a user ID alone is enough to get in.
    auth.status().then((s) => {
      setRequiresPassword(Boolean(s.required));
      setPhase('locked');
    });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (requiresPassword && password.trim()) {
        await auth.signIn(password.trim());
      }
      auth.setUserId(userId.trim());
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
        <p className="muted">
          {requiresPassword
            ? 'Enter your user ID and password to continue.'
            : 'Enter a user ID to keep your library backed up.'}
        </p>
        <input
          placeholder="User ID"
          value={userId}
          autoFocus
          autoComplete="username"
          onChange={(e) => setUserId(e.target.value)}
        />
        <input
          type="password"
          placeholder={requiresPassword ? 'Password' : 'Password (optional)'}
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button
          type="submit"
          disabled={busy || !userId.trim() || (requiresPassword && !password.trim())}
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
