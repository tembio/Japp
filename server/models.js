// Analysis models. DeepSeek: 5M free tokens on signup (30 days), then
// pay-as-you-go; needs DEEPSEEK_API_KEY.
export const MODELS = [
  { id: 'deepseek-v4-flash', provider: 'deepseek', label: 'DeepSeek V4 Flash — fastest' },
  { id: 'deepseek-v4-pro', provider: 'deepseek', label: 'DeepSeek V4 Pro — best quality' },
];

export const PROVIDER_LABELS = {
  deepseek: 'DeepSeek',
};

export const DEFAULT_MODEL = 'deepseek-v4-flash';
