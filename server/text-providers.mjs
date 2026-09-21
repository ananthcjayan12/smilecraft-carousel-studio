import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCodexPrompt, normalizeTextResult, parseJsonResponse, runCodex, textOutputSchema } from './codex.mjs';

const limit = (value, size) => String(value ?? '').slice(0, size);
const defaultModels = { codex: 'gpt-5.6-sol', openai: 'gpt-5.6-sol', gemini: 'gemini-3.1-pro', antigravity: '', claude: 'claude-sonnet-4-6' };

class CommandExecutionError extends Error {
  constructor(message, stdout = '', stderr = '', exitCode) { super(message); this.name = 'CommandExecutionError'; this.stdout = stdout; this.stderr = stderr; this.exitCode = exitCode; }
}

async function command(bin, args, { input = '', cwd, timeoutMs = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, shell: false, windowsHide: true, env: { ...process.env } });
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new CommandExecutionError(`${path.basename(bin)} timed out`, stdout, stderr)); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += String(chunk); if (stdout.length > 8_000_000) { child.kill('SIGTERM'); finish(new CommandExecutionError(`${path.basename(bin)} returned too much output`, stdout, stderr)); } });
    child.stderr.on('data', chunk => { stderr += String(chunk); if (stderr.length > 200_000) { child.kill('SIGTERM'); finish(new CommandExecutionError(`${path.basename(bin)} returned too many errors`, stdout, stderr)); } });
    child.on('error', error => finish(new CommandExecutionError(error.code === 'ENOENT' ? `${path.basename(bin)} is not installed or is not on PATH.` : error.message, stdout, stderr)));
    child.on('close', code => { if (code === 0) finish(null, stdout); else { const details = (stderr.trim() || stdout.trim()).slice(-3000); finish(new CommandExecutionError(`${path.basename(bin)} exited ${code}${details ? `: ${details}` : ''}`, stdout, stderr, code)); } });
    child.stdin.end(input);
  });
}

export function parseAgyModels(output) {
  const options = [], seen = new Set();
  for (const line of String(output).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z0-9][a-z0-9._:/-]*)(?:\t+| {2,})(\S.*?)\s*$/i);
    if (!match || seen.has(match[1])) continue;
    options.push({ id: match[1], label: match[2].trim() }); seen.add(match[1]);
  }
  return options;
}

export async function availableAgyModels(bin = process.env.AGY_BIN || 'agy') {
  const models = parseAgyModels(await command(bin, ['models'], { timeoutMs: 12000 }));
  if (!models.length) throw new Error('AGY CLI returned no recognizable models. Run `agy models` in Terminal to verify the signed-in account.');
  return models;
}

async function writeGenerationLog(workDir, outputName, details) {
  try {
    const directory = path.join(workDir, 'generation-logs', 'text'); await mkdir(directory, { recursive: true });
    const safeName = outputName.replace(/[^a-z0-9._-]+/gi, '-'); const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const content = JSON.stringify(details, null, 2); const latest = path.join(directory, `${safeName}-latest.json`);
    await Promise.all([writeFile(path.join(directory, `${safeName}-${stamp}.json`), content), writeFile(latest, content)]); return latest;
  } catch { return undefined; }
}

async function requestJson(provider, url, options) {
  const timeoutMs = Math.max(10000, Math.min(900000, Number(process.env.AI_TEXT_TIMEOUT_MS) || 600000));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal }); const raw = await response.text();
    let body = {}; try { body = JSON.parse(raw); } catch {}
    if (!response.ok) throw new Error(`${provider}: ${body.error?.message || body.error?.type || limit(raw, 1200) || `request failed (${response.status})`}`);
    return body;
  } catch (error) { if (error.name === 'AbortError') throw new Error(`${provider} timed out after ${Math.round(timeoutMs / 1000)} seconds.`); throw error; }
  finally { clearTimeout(timer); }
}

function extractText(value) { if (typeof value === 'string') return value; if (Array.isArray(value)) return value.map(part => part?.text || '').join(''); return ''; }
function contentIssues(task, parsed) {
  const slides = task === 'draft' ? parsed?.slides : [parsed]; const issues = [];
  if (!Array.isArray(slides) || (task === 'draft' && slides.length !== 5)) return ['return exactly five slides'];
  slides.forEach((slide, index) => {
    const prefix = task === 'draft' ? `slide ${index + 1}` : 'slide';
    if (!slide?.heading || String(slide.heading).length > 100) issues.push(`${prefix} heading must be 1–100 characters`);
    if (!slide?.body || String(slide.body).length > 240) issues.push(`${prefix} body must be 1–240 characters`);
    if (!slide?.visualPrompt || String(slide.visualPrompt).length > 550) issues.push(`${prefix} visualPrompt must be 1–550 characters`);
    if (/\*\*(?:heading|body|visual prompt)|(?:^|\n)\s*(?:heading|body|visual prompt)\s*:/i.test(`${slide?.heading || ''}\n${slide?.body || ''}\n${slide?.visualPrompt || ''}`)) issues.push(`${prefix} contains field labels or markdown instead of direct content`);
  });
  return issues;
}

export function textProviderStatus(codexAvailable, antigravityAvailable, codexAuthenticated = codexAvailable) {
  return {
    codex: { available: codexAvailable && codexAuthenticated, installed: codexAvailable, authenticated: codexAuthenticated, label: 'Codex CLI' },
    openai: { available: Boolean(process.env.OPENAI_API_KEY), label: 'OpenAI API' },
    gemini: { available: Boolean(process.env.GEMINI_API_KEY), label: 'Gemini API' },
    antigravity: { available: antigravityAvailable, label: 'Antigravity CLI (agy)' },
    claude: { available: Boolean(process.env.ANTHROPIC_API_KEY), label: 'Claude API' },
  };
}

export async function runTextProvider(task, payload) {
  const provider = String(payload.provider || 'codex'); const label = textProviderStatus(false, false)[provider]?.label || provider;
  const { workDir = process.cwd(), outputName: requestedOutputName, ...promptPayload } = payload;
  const model = limit(payload.model || defaultModels[provider], 100).trim(); const prompt = buildCodexPrompt(task, promptPayload); const schema = textOutputSchema(task);
  const jsonPrompt = `${prompt}\n\nReturn ONLY a complete JSON object satisfying this JSON schema, with no markdown or commentary:\n${JSON.stringify(schema)}`;
  const outputName = limit(requestedOutputName || `${task}-${provider}`, 80).replace(/[^a-z0-9._-]+/gi, '-'); const started = Date.now();
  if (provider === 'codex') return runCodex(task, { ...promptPayload, model });
  let raw = '', envelope;
  try {
    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('OpenAI API key is missing. Set OPENAI_API_KEY before starting the server.'), { status: 409 });
      if (!model) throw new Error('Choose an OpenAI text model.');
      envelope = await requestJson('OpenAI', 'https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: jsonPrompt }], response_format: { type: 'json_schema', json_schema: { name: 'carousel_content', strict: true, schema } } }) }); raw = envelope.choices?.[0]?.message?.content || '';
    } else if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error('Gemini API key is missing. Set GEMINI_API_KEY before starting the server.'), { status: 409 });
      if (!model) throw new Error('Choose a Gemini text model.');
      envelope = await requestJson('Gemini', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: jsonPrompt }] }], generationConfig: { responseMimeType: 'application/json' } }) }); raw = extractText(envelope.candidates?.[0]?.content?.parts);
    } else if (provider === 'claude') {
      if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error('Claude API key is missing. Set ANTHROPIC_API_KEY before starting the server.'), { status: 409 });
      if (!model) throw new Error('Choose a Claude text model.');
      envelope = await requestJson('Claude', 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 6000, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema } } }) }); raw = extractText(envelope.content);
    } else if (provider === 'antigravity') {
      const baseAgyPrompt = `TOOL-FREE STRUCTURED-OUTPUT TASK. Do not call tools, run commands, read files, browse, create artifacts, or inspect the workspace. Everything required is included below. Respond immediately with only the publication-ready content in the JSON object required by the schema. Never describe the work, announce completion, use markdown field labels, or put multiple fields inside one field.\n\n${jsonPrompt}`;
      let parsed, issues = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const agyPrompt = attempt === 1 ? baseAgyPrompt : `${baseAgyPrompt}\n\nYour previous response was rejected for these reasons: ${issues.join('; ')}. Correct every issue and return only the actual carousel content.`;
        raw = await command(process.env.AGY_BIN || 'agy', ['--disable-slash-commands', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--print-timeout', process.env.AGY_TEXT_TIMEOUT || '10m', ...(model ? ['--model', model] : []), '-p', agyPrompt], { cwd: workDir, timeoutMs: 660000 });
        try { envelope = JSON.parse(raw.trim()); } catch { throw new Error('Antigravity CLI returned an invalid JSON response envelope.'); }
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Antigravity CLI returned an invalid response envelope.');
        if (envelope.status !== 'SUCCESS') throw new Error(`Antigravity CLI: ${envelope.error || envelope.status || 'No response'}`);
        if (envelope.structured_output === undefined && !envelope.response?.trim() && envelope.denied_actions?.length) {
          const actions = envelope.denied_actions.map(action => action.display_name || action.action || 'unknown tool').join(', '); throw new Error(`Antigravity returned an empty response after attempting disallowed tool actions (${actions}).`);
        }
        parsed = envelope.structured_output && typeof envelope.structured_output === 'object' ? envelope.structured_output : parseJsonResponse(envelope.response || '', label);
        issues = contentIssues(task, parsed); if (!issues.length) break;
      }
      if (issues.length) throw new Error(`Antigravity CLI returned unusable carousel content after retry: ${issues.join('; ')}`);
      const result = normalizeTextResult(task, parsed, label);
      await writeGenerationLog(workDir, outputName, { timestamp: new Date().toISOString(), provider, model: model || '(AGY default)', status: 'success', durationMs: Date.now() - started, conversationId: envelope.conversation_id, rawOutput: raw, parsedOutput: parsed }); return result;
    } else throw Object.assign(new Error('Choose a supported writing provider.'), { status: 400 });
    const parsed = parseJsonResponse(raw, label); const result = normalizeTextResult(task, parsed, label);
    await writeGenerationLog(workDir, outputName, { timestamp: new Date().toISOString(), provider, model, status: 'success', durationMs: Date.now() - started, parsedOutput: parsed }); return result;
  } catch (error) {
    const logPath = await writeGenerationLog(workDir, outputName, { timestamp: new Date().toISOString(), provider, model: model || '(provider default)', status: 'failed', durationMs: Date.now() - started, error: error.message, stdout: error instanceof CommandExecutionError ? limit(error.stdout, 100000) : undefined, stderr: error instanceof CommandExecutionError ? limit(error.stderr, 30000) : undefined, responseEnvelope: envelope });
    const wrapped = new Error(`${error.message}${logPath ? ` Diagnostic log: ${logPath}` : ''}`); wrapped.status = error.status; throw wrapped;
  }
}
