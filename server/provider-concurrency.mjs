// All five image-generation providers in the UI share the same five-slide batch
// ceiling. A provider's actual account RPM, model limits and local CLI resources
// cannot be inferred by the app; adjust IMAGE_PARALLEL_* / TEXT_PARALLEL_* when
// necessary. Limits are per running server process, not provider-issued quotas.
const IMAGE_PROVIDERS = ['openai', 'gemini', 'codex', 'antigravity'];
const TEXT_PROVIDERS = ['codex', 'openai', 'gemini', 'antigravity', 'claude'];
const MAX_SLIDES = 5;
function configured(stage, provider, fallback) {
  const raw = process.env[stage.toUpperCase() + '_PARALLEL_' + provider.toUpperCase()];
  if (raw === undefined || raw === '') return fallback;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLIDES) {
    throw new Error(stage.toUpperCase() + '_PARALLEL_' + provider.toUpperCase() + ' must be an integer from 1 to 5.');
  }
  return count;
}
export const providerConcurrency = Object.freeze(Object.fromEntries(
  IMAGE_PROVIDERS.map(provider => [provider, configured('image', provider, ['codex', 'antigravity'].includes(provider) ? 2 : MAX_SLIDES)])
));
export const textConcurrency = Object.freeze(Object.fromEntries(
  TEXT_PROVIDERS.map(provider => [provider, configured('text', provider, ['codex', 'antigravity'].includes(provider) ? 2 : MAX_SLIDES)])
));
const active = new Map(), waiting = new Map(), peak = new Map();
const keysFor = stage => stage === 'text' ? textConcurrency : stage === 'image' ? providerConcurrency : null;
const slotKey = (stage, provider) => stage + ':' + provider;
export function providerActivity(stage = 'image') {
  const limits = keysFor(stage);
  if (!limits) throw new Error('Unsupported generation stage: ' + stage);
  return Object.fromEntries(Object.entries(limits).map(([provider, limit]) => {
    const key = slotKey(stage, provider);
    return [provider, { limit, active: active.get(key) || 0, queued: waiting.get(key)?.length || 0, peak: peak.get(key) || 0 }];
  }));
}
export async function withProviderSlot(provider, work, stage = 'image') {
  const limits = keysFor(stage), limit = limits?.[provider];
  if (!limit) throw Object.assign(new Error('Unsupported ' + stage + ' provider: ' + provider), { status: 400 });
  const key = slotKey(stage, provider);
  let queue = waiting.get(key);
  if (!queue) { queue = []; waiting.set(key, queue); }
  await new Promise(resolve => {
    const acquire = () => {
      const running = (active.get(key) || 0) + 1;
      active.set(key, running);
      peak.set(key, Math.max(peak.get(key) || 0, running));
      resolve();
    };
    if ((active.get(key) || 0) < limit && queue.length === 0) acquire();
    else queue.push(acquire);
  });
  try { return await work(); }
  finally {
    active.set(key, (active.get(key) || 1) - 1);
    const next = queue.shift();
    if (next) next();
  }
}
