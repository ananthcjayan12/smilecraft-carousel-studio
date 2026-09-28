import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { zipSync } from 'fflate';
import { apiRoute } from '../../cloudflare/studio.mjs';

function fixture() {
  const sqlite = new Database(':memory:');
  for (const name of ['0001_accounts_credits.sql', '0002_studio.sql', '0003_manual_plans.sql', '0004_job_corrections.sql', '0005_template_imports.sql']) sqlite.exec(readFileSync(`cloudflare/migrations/${name}`, 'utf8'));
  sqlite.exec("INSERT INTO accounts(id,name) VALUES('a','Owner'); INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES('c','a','Brand','general','{}','{}','2026-09-28','2026-09-28');");
  const objects = new Map();
  const DB = { prepare(sql) { return { bind(...params) { const stmt = sqlite.prepare(sql); return { first: async () => stmt.get(...params), all: async () => ({ results: stmt.all(...params) }), run: async () => ({ meta: stmt.run(...params) }) }; } }; } };
  const env = { DB, ASSETS: { put: async (key, value) => objects.set(key, value), get: async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key) } : null, delete: async key => objects.delete(key) } };
  const call = (path, method, value, account_id = 'a') => apiRoute(new Request(`https://test.example${path}`, { method, body: value }), env, { account_id }, new URL(`https://test.example${path}`));
  return { sqlite, env, call, objects };
}

test('private five-slide ZIP becomes a client reference and remains account-scoped', async () => {
  const { sqlite, call, objects } = fixture();
  const image = Uint8Array.from([137,80,78,71,13,10,26,10,...Array(20).fill(0)]);
  const zip = zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`slide-${i + 1}.png`, image])));
  const url = '/api/template-imports?clientId=c&businessPackId=general&scope=client';
  const staged = await call(url, 'POST', zip);
  assert.equal(staged.status, 201);
  const { id, preview } = await staged.json();
  assert.equal(preview.templates[0].slides.length, 5);
  const blocked = await call(`/api/template-imports/${id}/install`, 'POST', '{}', 'another-account').catch(error => error);
  assert.equal(blocked.status, 404);
  const result = await call(`/api/template-imports/${id}/install`, 'POST', '{}');
  assert.equal(result.status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM templates WHERE account_id=? AND client_id=?').get('a', 'c').n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM assets WHERE account_id=? AND client_id=?').get('a', 'c').n, 5);
  assert.equal(objects.size, 5);
  sqlite.close();
});

test('portable project import carries artwork into the private workspace', async () => {
  const { sqlite, call } = fixture();
  const image = 'data:image/png;base64,iVBORw0KGgoAAA';
  const slides = Array.from({ length: 5 }, (_, i) => ({ id: `slide-${i + 1}`, heading: `Slide ${i + 1}`, body: 'Copy', approved: true }));
  const response = await call('/api/clients/c/import-project', 'POST', JSON.stringify({ project: { businessPackId: 'general', topic: 'Imported', slides }, embeddedAssets: { artworks: { 'slide-1': image } } }));
  assert.equal(response.status, 201);
  const { project } = await response.json();
  assert.equal(project.topic, 'Imported');
  assert.ok(project.slides[0].artworkAssetId);
  assert.equal(project.slides[1].artworkAssetId, '');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM assets WHERE account_id=?').get('a').n, 1);
  sqlite.close();
});
