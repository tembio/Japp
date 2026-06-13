async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const api = {
  getSettings: () => request('/api/settings'),
  saveSettings: (settings) =>
    request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  saveKey: (provider, key) =>
    request('/api/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    }),
  allVocab: () => request('/api/vocab'),
  getLearnt: () => request('/api/learnt'),
  addLearnt: (word) =>
    request('/api/learnt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    }),
  removeLearnt: (word) => request(`/api/learnt/${encodeURIComponent(word)}`, { method: 'DELETE' }),
  getSaved: () => request('/api/saved'),
  myWords: () => request('/api/mywords'),
  addSaved: (word) =>
    request('/api/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    }),
  removeSaved: (word) => request(`/api/saved/${encodeURIComponent(word)}`, { method: 'DELETE' }),
  listSongs: () => request('/api/songs'),
  getSong: (id) => request(`/api/songs/${id}`),
  deleteSong: (id) => request(`/api/songs/${id}`, { method: 'DELETE' }),
  analyze: (payload) =>
    request('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};
