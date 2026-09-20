import { spawn } from 'node:child_process';
import { buildCodexPrompt, normalizeTextResult, parseJsonResponse, runCodex } from './codex.mjs';

const limit = (value, size) => String(value ?? '').slice(0, size);
const writingModels = {
  codex: ['gpt-5.6', 'gpt-5.6-codex'],
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  gemini: ['gemini-3.1-pro', 'gemini-3.8-flash', 'gemini-2.5-flash'],
  antigravity: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking'],
  claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
};
const slideProperties = { heading: { type: 'string' }, body: { type: 'string' }, visualPrompt: { type: 'string' } };
function outputSchema(task) {
  if (task === 'revise') return { type: 'object', properties: slideProperties, required: ['heading', 'body', 'visualPrompt'], additionalProperties: false };
  return {
    type: 'object',
    properties: {
      slides: { type: 'array', items: { type: 'object', properties: slideProperties, required: ['heading', 'body', 'visualPrompt'], additionalProperties: false } },
      instagram: { type: 'string' }, youtubeTitle: { type: 'string' }, youtubeDescription: { type: 'string' },
    },
    required: ['slides', 'instagram', 'youtubeTitle', 'youtubeDescription'], additionalProperties: false,
  };
}

async function fetchJson(url, options, timeoutMs = 180000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetch(url, { ...options, signal: controller.signal }); const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(json.error?.message || json.error?.type || json.error || `Provider request failed (${response.status}).`); return json; }
  finally { clearTimeout(timer); }
}
function extractText(value) { if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(p => p.text || '').join(''); return ''; }
function runAgy(prompt, model, task) { return new Promise((resolve, reject) => {
  const child = spawn(process.env.AGY_BIN || 'agy', ['--mode', 'plan', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(outputSchema(task)), '--print-timeout', process.env.AGY_TEXT_TIMEOUT || '2m', '-p', prompt], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', settled = false; const timer = setTimeout(() => { child.kill('SIGTERM'); done(new Error('Antigravity timed out.')); }, 150000);
  const done = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  child.on('error', e => done(new Error(e.code === 'ENOENT' ? 'Antigravity CLI (agy) is not installed.' : e.message)));
  child.on('close', code => done(code === 0 ? null : new Error(`agy exited with code ${code}. ${limit(err, 600)}`), out));
}); }

export function textProviderStatus(codexAvailable, antigravityAvailable) {
  return {
    codex: { available: codexAvailable, label: 'Codex CLI' }, openai: { available: Boolean(process.env.OPENAI_API_KEY), label: 'OpenAI API' },
    gemini: { available: Boolean(process.env.GEMINI_API_KEY), label: 'Gemini API' }, antigravity: { available: antigravityAvailable, label: 'Antigravity CLI (agy)' },
    claude: { available: Boolean(process.env.ANTHROPIC_API_KEY), label: 'Claude API' },
  };
}

export async function runTextProvider(task, payload) {
  const provider = String(payload.provider || 'codex'); const model = String(payload.model || writingModels[provider]?.[0] || '').slice(0, 100); const prompt = buildCodexPrompt(task, payload);
  if (provider === 'codex') return runCodex(task, { ...payload, model });
  let raw;
  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('OpenAI writing requires OPENAI_API_KEY in the server environment.'), { status: 409 });
    const json = await fetchJson('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }) }); raw = json.choices?.[0]?.message?.content;
  } else if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('Gemini writing requires GEMINI_API_KEY in the server environment.'), { status: 409 });
    const json = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) }); raw = extractText(json.candidates?.[0]?.content?.parts);
  } else if (provider === 'claude') {
    if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Claude writing requires ANTHROPIC_API_KEY in the server environment.'), { status: 409 });
    const json = await fetchJson('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema: outputSchema(task) } } }) }); raw = extractText(json.content);
  } else if (provider === 'antigravity') raw = await runAgy(prompt, model, task);
  else throw Object.assign(new Error('Choose a supported writing provider.'), { status: 400 });
  const label = textProviderStatus(false, false)[provider]?.label || provider;
  return normalizeTextResult(task, parseJsonResponse(raw, label), label);
}
