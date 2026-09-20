import http from 'node:http';
import fs from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCodex } from './codex.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'web');
const storage = path.join(root, 'storage', 'projects');
const port = Number(process.env.PORT) || 4178;
const host = process.env.HOST || '127.0.0.1';
await mkdir(storage, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const safeId = id => /^[\w-]{6,64}$/.test(id ?? '');
function send(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
function body(req, max = 18_000_000) { return new Promise((resolve, reject) => {
  let data = ''; let bytes = 0;
  req.on('data', chunk => { bytes += chunk.length; if (bytes > max) { reject(Object.assign(new Error('Request too large; resize uploaded images.'), { status: 413 })); req.destroy(); return; } data += chunk.toString(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
  req.on('error', reject);
}); }
function checkImage(url) { return typeof url === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url) && url.length < 10_000_000; }
const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini';
const codexCheck = spawnSync(process.env.CODEX_BIN || 'codex', ['--version'], { encoding: 'utf8', timeout: 4000 });
const codexAvailable = codexCheck.status === 0;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://${host}`);
  try {
    if (u.pathname === '/api/status' && req.method === 'GET') return send(res, 200, { codexAvailable, imagesAvailable: Boolean(process.env.OPENAI_API_KEY), imageModel, localOnly: host === '127.0.0.1' || host === 'localhost' });
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
      const p = await body(req);
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
      return send(res, 200, { draft: await runCodex('draft', { topic: String(data.topic).slice(0, 450), notes: String(data.notes || '').slice(0, 2000), language: data.language === 'en' ? 'English' : 'Malayalam', clinic: 'SmileCraft Dental Clinic' }) });
    }
    if (u.pathname === '/api/revise' && req.method === 'POST') {
      const data = await body(req, 80_000);
      if (!data.slide?.heading || !String(data.correction || '').trim()) return send(res, 400, { error: 'A slide and correction are required.' });
      return send(res, 200, { slide: await runCodex('revise', { topic: String(data.topic).slice(0, 450), slide: data.slide, correction: String(data.correction).slice(0, 1800), role: data.slide.role }) });
    }
    if (u.pathname === '/api/image' && req.method === 'POST') {
      if (!process.env.OPENAI_API_KEY) return send(res, 409, { error: 'AI image rendering needs OPENAI_API_KEY in your local server environment. The illustrated and upload-based templates work without it.' });
      const data = await body(req, 50_000);
      if (!String(data.prompt || '').trim()) return send(res, 400, { error: 'Enter an image prompt.' });
      const prompt = `Professional, premium editorial dental education illustration or photography for an Instagram carousel. No letters, words, logos, watermarks, charts, labels, numbers or typographic elements. Clean composition, deep teal and soft turquoise studio accents, ample negative space, warm natural light, realistic teeth and anatomically plausible dentistry where appropriate. SUBJECT: ${String(data.prompt).slice(0, 900)}`;
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 100000);
      try {
        const r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', signal: ac.signal, headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: imageModel, prompt, size: '1024x1024', n: 1, output_format: 'png' }) });
        const json = await r.json(); if (!r.ok || !json.data?.[0]?.b64_json) throw new Error(json.error?.message || 'Image provider did not return an image.');
        return send(res, 200, { image: `data:image/png;base64,${json.data[0].b64_json}` });
      } finally { clearTimeout(timer); }
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
