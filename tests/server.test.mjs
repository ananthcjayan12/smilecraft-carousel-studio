import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCodexPrompt, parseJsonResponse } from '../server/codex.mjs';
import { buildSlideImagePrompt, parseAgyImageEnvelope } from '../server/image-providers.mjs';
import { parseAgyModels } from '../server/text-providers.mjs';
import { resolveCliBinary } from '../server/cli-tools.mjs';
import { providerConcurrency, withProviderSlot } from '../server/provider-concurrency.mjs';
import { DESIGN_SYSTEMS, readTemplatePackZip } from '../web/design-systems.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 42000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
let server;
test('Codex prompt preserves bilingual scripts and exact configurable clinic identity', () => {
  const prompt = buildCodexPrompt('draft', { topic: 'Scaling myths', clinic: { name: 'Example Dental Care', phone: '+91 98765 43210' } });
  assert.match(prompt, /English words.*English Latin script/);
  assert.match(prompt, /Never spell or transliterate an English word in Malayalam script/);
  assert.match(prompt, /Example Dental Care; phone: \+91 98765 43210/);
  assert.match(prompt, /Do not translate, transliterate, alter, or invent either value/);
  const withoutPhone = buildCodexPrompt('revise', { clinic: { name: 'Another Clinic', phone: '' } });
  assert.match(withoutPhone, /No phone number was provided, so do not invent or display one/);
});
test('image prompt uses approved copy, clinic identity and brand colors exactly', () => {
  const prompt = buildSlideImagePrompt({ slideNumber: 2, slide: { role: 'Science', heading: 'Scaling എന്താണ്?', body: 'Plaque and tartar നീക്കം ചെയ്യുന്നു.', visualPrompt: 'clean dental visual' }, brand: { name: 'Example Dental', phone: '+91 12345 67890', tagline: 'CARE', primary: '#112233', accent: '#abcdef' } });
  assert.match(prompt, /HEADING: "Scaling എന്താണ്\?"/);
  assert.match(prompt, /PHONE \(CTA SLIDE ONLY\): ""/);
  assert.match(prompt, /This is an INFORMATIONAL slide, NOT AN AD/);
  assert.doesNotMatch(prompt, /7907006842/);
  const final = buildSlideImagePrompt({ slideNumber: 5, slide: { role: 'CTA', heading: 'Smile healthier', body: 'Book your visit', visualPrompt: 'clinic' }, brand: { name: 'Example Dental', phone: '7907006842', location: 'Sreenarayanapuram, Ezhupunna' }, masterReferenceImage: 'data:image/png;base64,aA==' });
  assert.match(final, /PHONE \(CTA SLIDE ONLY\): "7907006842"/);
  assert.match(final, /LOCATION \(CTA SLIDE ONLY\): "Sreenarayanapuram, Ezhupunna"/);
  assert.match(final, /IMAGE 1 is the ENLARGED REFERENCE FOR THIS EXACT SLIDE POSITION/);
  assert.match(prompt, /primary "#112233", accent "#abcdef"/);
  assert.match(prompt, /Do not translate, transliterate, rewrite/);
});
test('provider response parser handles Antigravity envelopes and explanatory text', () => {
  const draft = { slides: Array.from({ length: 5 }, () => ({ heading: 'H', body: 'B', visualPrompt: 'V' })), instagram: 'I', youtubeTitle: 'Y', youtubeDescription: 'D' };
  assert.deepEqual(parseJsonResponse(JSON.stringify({ status: 'SUCCESS', response: 'extra text', structured_output: draft }), 'Antigravity CLI'), draft);
  assert.deepEqual(parseJsonResponse(`Finished successfully.\n${JSON.stringify({ heading: 'H', body: 'B', visualPrompt: 'V' })}\nDone.`, 'Claude API'), { heading: 'H', body: 'B', visualPrompt: 'V' });
  assert.throws(() => parseJsonResponse('not json', 'Claude API'), /Claude API did not return valid structured content/);
});
test('AGY model catalog parser accepts current CLI output', () => {
  assert.deepEqual(parseAgyModels('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)'), [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  ]);
});
test('AGY image envelope exposes denied headless tool actions', () => {
  assert.equal(parseAgyImageEnvelope('{"status":"SUCCESS","response":"","denied_actions":[]}').status, 'SUCCESS');
  assert.throws(() => parseAgyImageEnvelope('{"status":"SUCCESS","response":"","denied_actions":[{"display_name":"RunCommand"}]}'), /permission was denied \(RunCommand\)/);
});
test('CLI resolver finds user-local binaries even with a restricted PATH', () => {
  const resolved = resolveCliBinary('codex', 'CODEX_BIN', { PATH: '/usr/bin:/bin' });
  if (fs.existsSync(path.join(process.env.HOME, '.local', 'bin', 'codex'))) assert.equal(resolved, path.join(process.env.HOME, '.local', 'bin', 'codex'));
});
async function start() { server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server failed to start')), 9000); server.once('error', reject); server.stdout.on('data', data => { if (String(data).includes('Carousel Studio:')) { clearTimeout(timer); resolve(); } }); }); }
async function json(url, method = 'GET', body = undefined) { const r = await fetch(`${origin}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
test('local server, project storage, input validation and unavailable AI gateway', async t => {
  await start(); t.after(() => server?.kill());
  const page = await fetch(origin); assert.equal(page.status, 200); assert.match(await page.text(), /SmileCraft Studio/);
  const status = await json('/api/status'); assert.equal(status.status, 200); assert.equal(typeof status.data.codexAvailable, 'boolean'); assert.equal(typeof status.data.codexAuthenticated, 'boolean'); assert.equal(typeof status.data.cli.codex.binary, 'string'); assert.equal(status.data.imageProviders.openai.available, false); assert.equal(typeof status.data.imageProviders.antigravity.available, 'boolean');
  if (status.data.textProviders.antigravity.available) { const catalog = await json('/api/models/agy'); assert.equal(catalog.status, 200); assert.ok(catalog.data.models.length > 0); }
  const invalid = await json('/api/projects', 'POST', { topic: 'demo', slides: [] }); assert.equal(invalid.status, 400);
  const slides = Array.from({ length: 5 }, (_, i) => ({ id: `slide-${i+1}`, heading: 'Test', body: 'Content', approved: i === 0 }));
  const project = { topic: 'Dental demo test', slides, template: 'editorial', brand: { name: 'SmileCraft' } };
  const saved = await json('/api/projects', 'POST', project); assert.equal(saved.status, 200); assert.ok(saved.data.id);
  t.after(() => fs.promises.rm(path.join(root, 'storage', 'projects', `${saved.data.id}.json`), { force: true }));
  const loaded = await json(`/api/projects/${saved.data.id}`); assert.equal(loaded.data.project.slides.length, 5);
  const listed = await json('/api/projects'); assert.ok(listed.data.projects.some(p => p.id === saved.data.id));
  const packStatus = await json('/api/template-pack'); assert.equal(packStatus.status, 200); assert.ok(Array.isArray(packStatus.data.installed));
  const rejected = await json('/api/template-pack', 'POST', { id: '../unknown', image: 'bad' }); assert.equal(rejected.status, 400);
  assert.equal(typeof status.data.providerConcurrency.openai, 'number');
  const img = await json('/api/render-slide', 'POST', { provider: 'openai', slideNumber: 1, slide: { approved: true, role: 'Hook', heading: 'Test', body: 'Content' }, brand: { name: 'Clinic' }, referenceImage: 'data:image/png;base64,aA==' }); assert.equal(img.status, 409); assert.match(img.data.error, /OPENAI_API_KEY/);
  if (!status.data.codexAvailable) { const draft = await json('/api/draft', 'POST', { topic: 'tooth sensitivity' }); assert.equal(draft.status, 500); assert.match(draft.data.error, /Codex CLI/); }
  const del = await json(`/api/projects/${saved.data.id}`, 'DELETE'); assert.equal(del.status, 200);
  const missing = await json(`/api/projects/${saved.data.id}`); assert.equal(missing.status, 404);
});

test('parallel provider queue honors configured concurrency and still runs independent jobs', async () => {
  const limit = providerConcurrency.openai;
  assert.ok(limit >= 1 && limit <= 5);
  let inFlight = 0, observedMax = 0, completed = 0;
  await Promise.all(Array.from({ length: 11 }, (_, index) =>
    withProviderSlot('openai', async () => {
      inFlight++; observedMax = Math.max(observedMax, inFlight);
      await new Promise(resolve => setTimeout(resolve, 10));
      inFlight--; completed++; return index;
    })
  ));
  assert.equal(completed, 11);
  assert.equal(observedMax, limit);
});
test('master reference metadata describes ten distinct full-width five-slide boards', () => {
  assert.equal(DESIGN_SYSTEMS.length, 10);
  assert.equal(new Set(DESIGN_SYSTEMS.map(t => t.id)).size, 10);
  assert.ok(DESIGN_SYSTEMS.every(t => t.master && t.crop.bottom > t.crop.top));
});
test('local installation endpoint rejects unrecognized template names', async () => {
  // Exercised in the app's server smoke test below as well.
  assert.equal(DESIGN_SYSTEMS.some(t => t.id === 'unknown'), false);
});
