// Client-side mirror of server/models.js so the model picker works offline.
// Keep in sync with the server copy (the server validates analyze requests
// against its own list).
export const MODELS = [
  { id: 'deepseek-v4-flash', provider: 'deepseek', label: 'DeepSeek V4 Flash — fastest' },
  { id: 'deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro — best quality' },
];

export const PROVIDER_LABELS = {
  deepseek: 'DeepSeek',
};

export const DEFAULT_MODEL = 'deepseek-v4-flash';
