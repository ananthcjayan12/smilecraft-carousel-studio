import http from 'node:http';
import fs from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { availableAgyModels, runTextProvider, textProviderStatus } from './text-providers.mjs';
import { generateSlideImage, imageProviderStatus } from './image-providers.mjs';
import { inspectCli } from './cli-tools.mjs';
import { providerConcurrency, textConcurrency, providerActivity, withProviderSlot } from './provider-concurrency.mjs';
import { MASTER_TEMPLATE_IDS } from '../web/design-systems.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'web');
const storage = path.join(root, 'storage', 'projects');
const templateStorage = path.join(site, 'assets', 'design-systems');
const port = Number(process.env.PORT) || 4178;
const host = process.env.HOST || '127.0.0.1';
await mkdir(storage, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const safeId = id => /^[\w-]{6,64}$/.test(id ?? '');
function send(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
function body(req, max = 18_000_000) { return new Promise((resolve, reject) => {
  let data = ''; let bytes = 0;
  req.on('data', chunk => { bytes += chunk.length; if (bytes > max) { reject(Object.assign(new Error('Request too large; resize uploaded images.'), { status: 413 })); req.destroy(); return; } data += chunk.toString(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
}); }
const codexCli = inspectCli('codex', 'CODEX_BIN', { authArgs: ['login', 'status'] });
const antigravityCli = inspectCli('agy', 'AGY_BIN');
if (codexCli.installed) process.env.CODEX_BIN = codexCli.binary;
if (antigravityCli.installed) process.env.AGY_BIN = antigravityCli.binary;
const codexAvailable = codexCli.installed;
const codexAuthenticated = codexCli.authenticated;
const antigravityAvailable = antigravityCli.installed;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${host}`);
  try {
    if (u.pathname === '/api/status' && req.method === 'GET') {
      const textProviders = textProviderStatus(codexAvailable, antigravityAvailable, codexAuthenticated);
      const imageProviders = imageProviderStatus(codexAvailable && codexAuthenticated, antigravityAvailable);
      Object.assign(textProviders.codex, { path: codexCli.binary, version: codexCli.version, error: codexCli.error });
      Object.assign(imageProviders.codex, { installed: codexAvailable, authenticated: codexAuthenticated, path: codexCli.binary, version: codexCli.version, error: codexCli.error });
      Object.assign(textProviders.antigravity, { path: antigravityCli.binary, version: antigravityCli.version, error: antigravityCli.error });
      Object.assign(imageProviders.antigravity, { path: antigravityCli.binary, version: antigravityCli.version, error: antigravityCli.error });
      return send(res, 200, { codexAvailable, codexAuthenticated, cli: { codex: codexCli, antigravity: antigravityCli }, textProviders, imageProviders, providerConcurrency, textConcurrency, localOnly: host === '127.0.0.1' || host === 'localhost' });
    }
    if (u.pathname === '/api/generation-activity' && req.method === 'GET') {
      return send(res, 200, { image: providerActivity('image'), text: providerActivity('text') });
    }
    if (u.pathname === '/api/template-pack' && req.method === 'GET') {
      const installed = [];
      for (const id of MASTER_TEMPLATE_IDS) {
        if (fs.existsSync(path.join(templateStorage, id + '.png'))) installed.push(id);
      }
      return send(res, 200, { installed, logoInstalled: fs.existsSync(path.join(templateStorage, 'clinic-logo.jpg')) });
    }
    if (u.pathname === '/api/template-pack' && req.method === 'POST') {
      const data = await body(req, 11_000_000);
      const id = String(data.id || '');
      const isLogo = id === 'clinic-logo';
      if (!isLogo && !MASTER_TEMPLATE_IDS.has(id)) return send(res, 400, { error: 'Unknown template pack image.' });
      const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(data.image || ''));
      if (!match || (isLogo ? match[1] !== 'jpeg' : match[1] !== 'png')) return send(res, 400, { error: 'Expected a PNG design board or JPEG clinic logo.' });
      const bytes = Buffer.from(match[2], 'base64');
      const valid = isLogo ? bytes[0] === 0xff && bytes[1] === 0xd8 : bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      if (!valid || bytes.length < 10_000 || bytes.length > 8_000_000) return send(res, 400, { error: 'Template image is invalid or too large.' });
      await mkdir(templateStorage, { recursive: true });
      const filename = isLogo ? 'clinic-logo.jpg' : id + '.png';
      await writeFile(path.join(templateStorage, filename), bytes);
      return send(res, 200, { ok: true, id });
    }
    if (u.pathname === '/api/models/agy' && req.method === 'GET') {
      if (!antigravityAvailable) return send(res, 409, { error: 'Antigravity CLI (agy) is not installed or is not on PATH.' });
      return send(res, 200, { models: await availableAgyModels(process.env.AGY_BIN || 'agy') });
    }
    if (u.pathname === '/api/projects' && req.method === 'GET') {
      const items = [];
      for (const f of await readdir(storage)) if (f.endsWith('.json')) {
        try { const p = JSON.parse(await readFile(path.join(storage, f), 'utf8')); items.push({ id: p.id, topic: p.topic, updatedAt: p.updatedAt, template: p.template, approved: p.slides?.filter(s => s.approved).length || 0, count: p.slides?.length || 0 }); } catch {}
      }
      return send(res, 200, { projects: items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
    }
    if (u.pathname.startsWith('/api/projects/') && req.method === 'GET') {
      const id = u.pathname.split('/').pop(); if (!safeId(id)) return send(res, 400, { error: 'Invalid project ID' });
      try { return send(res, 200, { project: JSON.parse(await readFile(path.join(storage, `${id}.json`), 'utf8')) }); }
      catch (e) { if (e.code === 'ENOENT') return send(res, 404, { error: 'Project not found' }); throw e; }
    }
    if (u.pathname === '/api/projects' && req.method === 'POST') {
      const p = await body(req, 90_000_000);
      if (typeof p.topic !== 'string' || !Array.isArray(p.slides) || p.slides.length !== 5) return send(res, 400, { error: 'A topic and exactly five slides are required.' });
      if (p.id && !safeId(p.id)) return send(res, 400, { error: 'Invalid project ID.' });
      const id = p.id || crypto.randomUUID(); const updatedAt = new Date().toISOString();
      const project = { ...p, id, updatedAt };
      await writeFile(path.join(storage, `${id}.json`), JSON.stringify(project));
      return send(res, 200, { id, updatedAt });
    }
    if (u.pathname.startsWith('/api/projects/') && req.method === 'DELETE') {
      const id = u.pathname.split('/').pop(); if (!safeId(id)) return send(res, 400, { error: 'Invalid project ID' });
      await fs.promises.rm(path.join(storage, `${id}.json`), { force: true }); return send(res, 200, { ok: true });
    }
    if (u.pathname === '/api/draft' && req.method === 'POST') {
      const data = await body(req, 70_000);
      if (!String(data.topic || '').trim()) return send(res, 400, { error: 'Enter a topic before generating copy.' });
      const clinic = { name: String(data.clinic?.name || '').slice(0, 80), phone: String(data.clinic?.phone || '').slice(0, 40) };
      return send(res, 200, { draft: await withProviderSlot(String(data.provider || 'codex').slice(0, 30), () => runTextProvider('draft', { topic: String(data.topic).slice(0, 450), notes: String(data.notes || '').slice(0, 2000), language: 'Malayalam-English mix', clinic, provider: String(data.provider || 'codex').slice(0, 30), model: String(data.model || '').slice(0, 100), workDir: path.join(root, 'storage'), outputName: 'carousel-draft' }), 'text') });
    }
    if (u.pathname === '/api/revise' && req.method === 'POST') {
      const data = await body(req, 80_000);
      if (!data.slide?.heading || !String(data.correction || '').trim()) return send(res, 400, { error: 'A slide and correction are required.' });
      const clinic = { name: String(data.clinic?.name || '').slice(0, 80), phone: String(data.clinic?.phone || '').slice(0, 40) };
      return send(res, 200, { slide: await withProviderSlot(String(data.provider || 'codex').slice(0, 30), () => runTextProvider('revise', { topic: String(data.topic).slice(0, 450), slide: data.slide, correction: String(data.correction).slice(0, 1800), role: data.slide.role, clinic, provider: String(data.provider || 'codex').slice(0, 30), model: String(data.model || '').slice(0, 100), workDir: path.join(root, 'storage'), outputName: `slide-${String(data.slide.id || 'revision').slice(0, 30)}` }), 'text') });
    }
    if (u.pathname === '/api/render-slide' && req.method === 'POST') {
      const data = await body(req, 30_000_000);
      return send(res, 200, { image: await withProviderSlot(data.provider, () => generateSlideImage({ ...data, workDir: path.join(root, 'storage') })) });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    let file = path.resolve(site, `.${decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)}`);
    if (!(file === site || file.startsWith(site + path.sep))) return send(res, 403, { error: 'Forbidden.' });
    if (!path.extname(file)) file = path.join(file, 'index.html');
    let stat; try { stat = await fs.promises.stat(file); } catch { return send(res, 404, { error: 'Not found.' }); }
    if (!stat.isFile()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); fs.createReadStream(file).pipe(res);
  } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Unexpected error.' }); }
});
server.listen(port, host, () => console.log(`SmileCraft Carousel Studio: http://${host}:${port}`));
