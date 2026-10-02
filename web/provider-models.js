const levels = (id, label, efforts) => [[id, label], ...efforts.map(level => [`${id}-${level}`, `${label} (${level[0].toUpperCase()+level.slice(1)})`])];
export const IMAGE_MODELS = {
  openai: [['gpt-image-2', 'GPT Image 2'], ['gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst'], ['gpt-image-2.5-flare', 'GPT Image 2.5 Flare'], ['gpt-image-1', 'GPT Image 1'], ['gpt-image-1-mini', 'GPT Image 1 mini']],
  gemini: [['gemini-3.1-flash-image', 'Gemini 3.1 Flash Image (Nano Banana 2)'], ['gemini-3-pro-image', 'Gemini 3 Pro Image (Nano Banana Pro)'], ['gemini-3.1-flash-lite-image', 'Gemini 3.1 Flash Lite Image'], ['gemini-2.5-flash-image', 'Gemini 2.5 Flash Image']],
  codex: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna'], ['imagegen', 'Codex default']],
  antigravity: [['gemini-3.1-flash-image', 'Nano Banana 2 (managed by Antigravity)']],
};
export const WRITING_MODELS = {
  codex: [['gpt-5.6-sol', 'GPT-5.6 Sol'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['gpt-5.6-luna', 'GPT-5.6 Luna']],
  openai: ['sol','terra','luna'].flatMap(name => { const id=`gpt-5.6-${name}`,label=`GPT-5.6 ${name[0].toUpperCase()+name.slice(1)}`; return [[id,label],...['none','low','medium','high','xhigh','max'].map(effort=>[`${id}::${effort}`,`${label} (${effort==='xhigh'?'Extra high':effort[0].toUpperCase()+effort.slice(1)})`])]; }),
  gemini: [
    ...levels('gemini-3.1-pro', 'Gemini 3.1 Pro', ['low','medium','high']),
    ...['3.8','3.7','3.6','3.5'].flatMap(version => levels(`gemini-${version}-flash`, `Gemini ${version} Flash`, version==='3.8'||version==='3.7'?['low','medium','high']:['minimal','low','medium','high'])),
    ...levels('gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', ['minimal','low','medium','high']),
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'], ['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite'],
  ],
  antigravity: [['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'], ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'], ['gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'], ['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'], ['gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)']],
  claude: [['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['claude-opus-4-6', 'Claude Opus 4.6'], ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5']],
};

export function compatibleModel(provider, model, kind = 'writing') {
  const value = String(model || '').trim();
  const catalog = kind === 'image' ? IMAGE_MODELS : WRITING_MODELS;
  const options = catalog[provider];
  if (!options) throw Object.assign(new Error('Choose a supported provider.'), { status: 400 });
  if (!value) return provider === 'antigravity' && kind !== 'image' ? '' : options[0][0];
  if (kind === 'image' && provider === 'codex' && /^gpt-\d[\w.-]*$/.test(value)) return value;
  if (kind === 'image' && ['codex','antigravity'].includes(provider)) return options.some(([id]) => id === value) ? value : options[0][0];
  if (provider === 'antigravity') return value;
  if (options.some(([id]) => id === value)) return value;
  // Repair models carried over from another provider in older saved projects.
  if (provider === 'codex' && /^(gpt-image|gemini|claude)/.test(value)) return options[0][0];
  if (provider === 'gemini' && !value.startsWith('gemini-')) return options[0][0];
  if (provider === 'claude' && !value.startsWith('claude-')) return options[0][0];
  if (provider === 'openai' && (kind === 'image' ? !value.startsWith('gpt-image-') : /^(gemini|claude|gpt-image)/.test(value))) return options[0][0];
  return value;
}

// Picker ids keep the chosen effort in saved settings; provider requests use the base model.
export function textModelSettings(provider, selected) {
  const value = String(selected || '');
  if (provider === 'gemini') {
    const listed = WRITING_MODELS.gemini.some(([id]) => id === value);
    const match = listed && value.match(/^(gemini-3\.[\w.-]+)-(minimal|low|medium|high)$/);
    if (match) return { model: match[1], thinkingConfig: { thinkingLevel: match[2] } };
  }
  if (provider === 'codex' || provider === 'openai') {
    const match = value.match(/^(.+)::(none|low|medium|high|xhigh|max|ultra)$/);
    if (provider === 'openai' && !WRITING_MODELS.openai.some(([id]) => id === value)) return { model: value };
    if (match) return { model: match[1], reasoningEffort: match[2] };
  }
  return { model: value };
}
export function codexTextModelArgs(selected) {
  const { model, reasoningEffort } = textModelSettings('codex', selected);
  return [...(model ? ['--model', model] : []), ...(reasoningEffort ? ['-c', `model_reasoning_effort="${reasoningEffort}"`] : [])];
}
