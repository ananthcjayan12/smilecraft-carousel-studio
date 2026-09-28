import { IMAGE_MODELS, WRITING_MODELS, compatibleModel } from './provider-models.js';

export function repairGeneration(g = {}) {
  const provider = ['openai', 'gemini', 'codex', 'antigravity'].includes(g.provider) ? g.provider : 'openai';
  const writingProvider = ['openai', 'gemini', 'claude', 'codex', 'antigravity'].includes(g.writingProvider) ? g.writingProvider : 'openai';
  const model = provider === 'codex' ? 'imagegen' : compatibleModel(provider, g.model, 'image');
  return { ...g, provider, writingProvider, model, writingModel: ['codex', 'antigravity'].includes(writingProvider) ? String(g.writingModel || '') : compatibleModel(writingProvider, g.writingModel) };
}

export function generationControls(g, status, kind, escape, agyModels = []) {
  const image = kind === 'image', providerKey = image ? 'provider' : 'writingProvider', modelKey = image ? 'model' : 'writingModel';
  const catalog = image ? IMAGE_MODELS : WRITING_MODELS, statuses = image ? status.imageProviders : status.textProviders;
  const provider = g[providerKey], options = provider === 'antigravity' && !image && agyModels.length ? agyModels.map(m => [m.id, m.label]) : [...catalog[provider]];
  if (!options.some(([id]) => id === g[modelKey])) options.unshift([g[modelKey] || '', g[modelKey] || 'CLI default']);
  const labels = { codex: 'Codex CLI', openai: 'OpenAI API', gemini: 'Gemini API', antigravity: 'Antigravity CLI', claude: 'Claude API' };
  return `<label class="formlabel">${image ? 'Image' : 'Writing'} provider</label><select class="control" data-generation="${providerKey}">${Object.keys(catalog).map(id => `<option value="${id}" ${id === provider ? 'selected' : ''}>${labels[id]} · ${statuses?.[id]?.available ? 'Ready' : 'Unavailable'}</option>`).join('')}</select><label class="formlabel">Model</label><select class="control" data-generation="${modelKey}">${options.map(([id, label]) => `<option value="${escape(id)}" ${id === g[modelKey] ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select>${image && ['codex','antigravity'].includes(provider) ? '<p class="muted">The CLI manages its built-in image model. Choose OpenAI or Gemini API to select an image model explicitly.</p>' : ''}${provider === 'antigravity' && !image ? '<button class="btn tiny" data-action="refresh-agy">Refresh AGY models</button>' : ''}`;
}

export function friendlyGenerationError(error) {
  const text = String(error?.message || error || 'Generation failed.');
  if (/not supported when using Codex|Model metadata.*gpt-image/s.test(text)) return 'The image API model was sent to Codex. Select Codex CLI again to reset its model, then retry the missing slides.';
  const detail = text.match(/"message"\s*:\s*"([^"\n]+)"/g)?.at(-1);
  return (detail ? detail.replace(/^"message"\s*:\s*"|"$/g, '') : text.split(' Diagnostic log:')[0]).slice(0, 350);
}
