import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 42000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
let server;
async function start() { server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] }); await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server failed to start')), 9000); server.once('error', reject); server.stdout.on('data', data => { if (String(data).includes('Carousel Studio:')) { clearTimeout(timer); resolve(); } }); }); }
async function json(url, method = 'GET', body = undefined) { const r = await fetch(`${origin}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
test('local server, project storage, input validation and unavailable AI gateway', async t => {
  await start(); t.after(() => server?.kill());
  const page = await fetch(origin); assert.equal(page.status, 200); assert.match(await page.text(), /SmileCraft Studio/);
  const status = await json('/api/status'); assert.equal(status.status, 200); assert.equal(typeof status.data.codexAvailable, 'boolean'); assert.equal(status.data.imagesAvailable, false);
  const invalid = await json('/api/projects', 'POST', { topic: 'demo', slides: [] }); assert.equal(invalid.status, 400);
  const slides = Array.from({ length: 5 }, (_, i) => ({ id: `slide-${i+1}`, heading: 'Test', body: 'Content', approved: i === 0 }));
  const project = { topic: 'Dental demo test', slides, template: 'editorial', brand: { name: 'SmileCraft' } };
  const saved = await json('/api/projects', 'POST', project); assert.equal(saved.status, 200); assert.ok(saved.data.id);
  t.after(() => fs.promises.rm(path.join(root, 'storage', 'projects', `${saved.data.id}.json`), { force: true }));
  const loaded = await json(`/api/projects/${saved.data.id}`); assert.equal(loaded.data.project.slides.length, 5);
  const listed = await json('/api/projects'); assert.ok(listed.data.projects.some(p => p.id === saved.data.id));
  const img = await json('/api/image', 'POST', { prompt: 'white tooth' }); assert.equal(img.status, 409); assert.match(img.data.error, /OPENAI_API_KEY/);
  if (!status.data.codexAvailable) { const draft = await json('/api/draft', 'POST', { topic: 'tooth sensitivity' }); assert.equal(draft.status, 500); assert.match(draft.data.error, /Codex CLI/); }
  const del = await json(`/api/projects/${saved.data.id}`, 'DELETE'); assert.equal(del.status, 200);
  const missing = await json(`/api/projects/${saved.data.id}`); assert.equal(missing.status, 404);
});
