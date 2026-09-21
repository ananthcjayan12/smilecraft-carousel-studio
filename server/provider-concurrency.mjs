// Quota and CLI capacity vary by account and workstation. API providers default
// to five jobs (one per slide), CLIs to two; tune IMAGE_PARALLEL_<PROVIDER>
// when an account or machine cannot support the default.
function configured(name, fallback) {
  const raw = process.env['IMAGE_PARALLEL_' + name.toUpperCase()];
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? Math.min(n, 5) : fallback;
}
export const providerConcurrency = Object.freeze({
  openai: configured('openai', 5),
  gemini: configured('gemini', 5),
  codex: configured('codex', 2),
  antigravity: configured('antigravity', 2),
});
const active = new Map(), waiting = new Map();

export async function withProviderSlot(provider, work) {
  const limit = providerConcurrency[provider];
  if (!limit) return work(); // Existing image provider validates unsupported names.
  let queue = waiting.get(provider);
  if (!queue) { queue = []; waiting.set(provider, queue); }
  await new Promise(resolve => {
    const acquire = () => { active.set(provider, (active.get(provider) || 0) + 1); resolve(); };
    if ((active.get(provider) || 0) < limit && queue.length === 0) acquire();
    else queue.push(acquire);
  });
  try { return await work(); }
  finally {
    active.set(provider, (active.get(provider) || 1) - 1);
    const next = queue.shift();
    if (next) next();
  }
}
