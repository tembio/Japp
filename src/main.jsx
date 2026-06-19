import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import { isSeeded, seed } from './store.js';
import './styles.css';

// On the very first launch, pull the existing library from the server (if
// reachable) into on-device storage so nothing is lost in the move offline.
// Every launch after that reads straight from IndexedDB — no network needed.
async function maybeSeed() {
  try {
    if (await isSeeded()) return;
    const base = import.meta.env.VITE_API_BASE ?? '';
    const res = await fetch(base + '/api/export');
    if (res.ok) await seed(await res.json());
  } catch {
    // Offline or no server: start empty and retry seeding on a future launch.
  }
}

maybeSeed().finally(() => {
  createRoot(document.getElementById('root')).render(
    <AuthGate>
      <App />
    </AuthGate>
  );
});
