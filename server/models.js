// Gemini list: free-tier text models (ai.google.dev/gemini-api/docs/pricing, June 2026).
// DeepSeek: 5M free tokens on signup (30 days), then pay-as-you-go; needs DEEPSEEK_API_KEY.
export const MODELS = [
  { id: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash — best quality' },
  { id: 'gemini-3.1-flash-lite', provider: 'gemini', label: 'Gemini 3.1 Flash-Lite — fastest' },
  { id: 'gemini-3-flash-preview', provider: 'gemini', label: 'Gemini 3 Flash (preview)' },
  { id: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', provider: 'gemini', label: 'Gemini 2.5 Flash-Lite' },
  { id: 'deepseek-v4-flash', provider: 'deepseek', label: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro' },
];

export const PROVIDER_LABELS = {
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

export const DEFAULT_MODEL = 'gemini-3.5-flash';
