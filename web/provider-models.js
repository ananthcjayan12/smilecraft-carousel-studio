export const IMAGE_MODELS = {
  openai: [['gpt-image-2', 'GPT Image 2'], ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'], ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare'], ['gpt-image-1', 'GPT Image 1'], ['gpt-image-1-mini', 'GPT Image 1 mini']],
  gemini: [['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image (Nano Banana 2)'], ['gemini-3-pro-image', 'Gemini 3 Pro Image (Nano Banana Pro)'], ['gemini-3.1-flash-lite-image', 'Gemini 3.1 Flash Lite Image'], ['gemini-2.5-flash-image', 'Gemini 2.5 Flash Image']],
  codex: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna']],
  antigravity: [['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'], ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'], ['gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'], ['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'], ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)']],
};
export const WRITING_MODELS = {
  codex: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna']],
  openai: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna']],
  gemini: [['gemini-3.1-pro', 'Gemini 3.1 Pro'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-2.5-flash', 'Gemini 2.5 Flash']],
  antigravity: [['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'], ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)']],
  claude: [['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-6', 'Claude Opus 4.6'], ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5']],
};

export function compatibleModel(provider, model, kind = 'writing') {
  const value = String(model || '').trim();
  const catalog = kind === 'image' ? IMAGE_MODELS : WRITING_MODELS;
  const options = catalog[provider];
  if (!options) throw Object.assign(new Error('Choose a supported provider.'), { status: 400 });
  if (!value) return provider === 'antigravity' ? '' : options[0][0];
  if (provider === 'antigravity') return /^(gpt-image|gemini-.*image)/.test(value) ? '' : value;
  if (options.some(([id]) => id === value)) return value;
  // Repair models carried over from another provider in older saved projects.
  if (provider === 'codex' && /^(gpt-image|gemini|claude)/.test(value)) return options[0][0];
  if (provider === 'gemini' && !value.startsWith('gemini-')) return options[0][0];
  if (provider === 'claude' && !value.startsWith('claude-')) return options[0][0];
  if (provider === 'openai' && (kind === 'image' ? !value.startsWith('gpt-image-') : /^(gemini|claude|gpt-image)/.test(value))) return options[0][0];
  return value;
}
