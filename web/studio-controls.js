import { IMAGE_MODELS, WRITING_MODELS, compatibleModel } from './provider-models.js';

export function repairGeneration(g = {}) {
  const provider = IMAGE_MODELS[g.provider] ? g.provider : 'openai';
  const writingProvider = WRITING_MODELS[g.writingProvider] ? g.writingProvider : 'codex';
  return { ...g, provider, writingProvider, model: compatibleModel(provider, g.model, 'image'), writingModel: compatibleModel(writingProvider, g.writingModel) };
}

export function generationControls(g, status, kind, escape, agyModels = []) {
  const image = kind === 'image', providerKey = image ? 'provider' : 'writingProvider', modelKey = image ? 'model' : 'writingModel';
  const catalog = image ? IMAGE_MODELS : WRITING_MODELS, statuses = image ? status.imageProviders : status.textProviders;
  const provider = g[providerKey], options = provider === 'antigravity' && agyModels.length ? agyModels.map(m => [m.id, m.label]) : [...catalog[provider]];
  if (!options.some(([id]) => id === g[modelKey])) options.unshift([g[modelKey] || '', g[modelKey] || 'CLI default']);
  const labels = { codex: 'Codex CLI', openai: 'OpenAI API', gemini: 'Gemini API', antigravity: 'Antigravity CLI', claude: 'Claude API' };
  return `<label class="formlabel">${image ? 'Image' : 'Writing'} provider</label><select class="control" data-generation="${providerKey}">${Object.keys(catalog).map(id => `<option value="${id}" ${id === provider ? 'selected' : ''}>${labels[id]} · ${statuses?.[id]?.available ? 'Ready' : 'Unavailable'}</option>`).join('')}</select><label class="formlabel">${provider === 'codex' && image ? 'Codex model (uses built-in image generation)' : 'Model'}</label><select class="control" data-generation="${modelKey}">${options.map(([id, label]) => `<option value="${escape(id)}" ${id === g[modelKey] ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select>${provider === 'antigravity' ? '<button class="btn tiny" data-action="refresh-agy">Refresh AGY models</button>' : ''}`;
}

export function friendlyGenerationError(error) {
  const text = String(error?.message || error || 'Generation failed.');
  if (/not supported when using Codex|Model metadata.*gpt-image/s.test(text)) return 'The image API model was sent to Codex. Select Codex CLI again to reset its model, then retry the missing slides.';
  const detail = text.match(/"message"\s*:\s*"([^"\n]+)"/g)?.at(-1);
  return (detail ? detail.replace(/^"message"\s*:\s*"|"$/g, '') : text.split(' Diagnostic log:')[0]).slice(0, 350);
}
