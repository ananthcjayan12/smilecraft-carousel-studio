import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { cloudV4 } from '../cloudflare/v4.mjs';
import { seedPlan, demoIds, DEMO_CREDITS } from '../scripts/demo/seed.mjs';
import { DEMO_CLINICS, ASSET_DIR } from '../server/v4/demo-clinics.mjs';

const migrations = new URL('../cloudflare/migrations/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL(`../${ASSET_DIR}/manifest.json`, import.meta.url), 'utf8'));

async function seeded({ ready = true } = {}) {
  const sqlite = new Database(':memory:');
  for (const file of (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(await readFile(new URL(file, migrations), 'utf8'));
  sqlite.pragma('foreign_keys = ON');
  const { sql, uploads } = seedPlan(manifest, new Date('2026-10-04T09:00:00Z'), { ready });
  sqlite.exec(sql); sqlite.exec(sql); // re-running resets rather than duplicating
  const objects = new Map(await Promise.all(uploads.map(async u => [u.key, { bytes: await readFile(u.file), httpMetadata: { contentType: u.mime } }])));
  const DB = { prepare: sql => ({ bind: (...v) => { const s = sqlite.prepare(sql); return { first: async () => s.get(...v) || null, run: async () => ({ meta: s.run(...v) }), all: async () => ({ results: s.all(...v) }) }; } }) };
  const queued = [], png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
  const IMAGES = { info: async s => sharp(Buffer.from(await new Response(s).arrayBuffer())).metadata(), input: s => ({ transform() { return this; }, async output() { const b = await sharp(Buffer.from(await new Response(s).arrayBuffer())).png().toBuffer(); return { response: () => new Response(b) }; } }) };
  const env = { DEMO_PAUSE_SCALE: '0', DB, IMAGES, APP_ORIGIN: 'https://studio.test', OPENAI_API_KEY: 'test-only', GENERATION: { send: async b => queued.push(b.v4JobId) },
    ASSETS: { get: async k => objects.get(k) && { arrayBuffer: async () => objects.get(k).bytes, httpMetadata: objects.get(k).httpMetadata }, put: async (k, b, m) => objects.set(k, { bytes: Buffer.from(b), ...m }) } };
  const service = cloudV4(env);
  const drain = async () => { while (queued.length) await Promise.all(queued.splice(0).map(id => service.consume(id))); };
  const call = async (account, path, method = 'GET', body) => { const r = await service.route(new Request(`https://studio.test/api/v4${path}`, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), account, new URL(`https://studio.test/api/v4${path}`)); if (!r.ok) throw new Error((await r.json()).error); return r.headers.get('Content-Type')?.includes('json') ? r.json() : r; };
  return { sqlite, call, service, queued, png, uploads, drain };
}

test('demo seed --ready restores two active clinics with their prepared week', async () => {
  const f = await seeded();
  assert.equal(f.uploads.length, 3 * Object.keys(manifest).length);
  for (const clinic of DEMO_CLINICS) {
    const ids = demoIds(clinic), data = await f.call(ids.account, `/clinics/${ids.clinic}`);
    assert.equal(data.clinic.status, 'active');
    assert.equal(data.styles.filter(s => s.status === 'ready').length, 3);
    const { week } = await f.call(ids.account, `/clinics/${ids.clinic}/weeks?latest=1`);
    assert.equal(week.week_start, '2026-09-28');
    assert.deepEqual(week.items.map(i => i.type), ['carousel', 'carousel', 'post', 'post', 'story', 'story']);
    assert.equal(week.ready, clinic.items.filter(i => !i.live).length);
    const preview = await f.call(ids.account, `/assets/${week.items[0].frames[0].assetId}/preview`);
    assert.equal(preview.headers.get('Content-Type'), 'image/webp');
    assert.equal(f.sqlite.prepare('SELECT SUM(amount) n FROM credit_ledger WHERE account_id=?').get(ids.account).n, DEMO_CREDITS);
  }
  // One demo account cannot read the other's clinic.
  await assert.rejects(f.call(demoIds(DEMO_CLINICS[0]).account, `/clinics/${demoIds(DEMO_CLINICS[1]).clinic}`), /Clinic not found/);
  f.sqlite.close();
});

test('the live demo post generates real artwork from its approved copy', async t => {
  const f = await seeded(), clinic = DEMO_CLINICS.find(c => c.items.some(i => i.live)), ids = demoIds(clinic);
  const live = `demo-item-${clinic.key}-${clinic.items.find(i => i.live).key}`;
  t.mock.method(globalThis, 'fetch', async url => { assert.equal(url, 'https://api.openai.com/v1/images/edits'); return Response.json({ data: [{ b64_json: f.png.toString('base64') }] }); });
  await f.call(ids.account, `/content/${live}/generate`, 'POST', {});
  assert.equal(f.queued.length, 1);
  await f.service.consume(f.queued.shift());
  const { item } = await f.call(ids.account, `/content/${live}`);
  assert.equal(item.status, 'ready');
  const { week } = await f.call(ids.account, `/clinics/${ids.clinic}/weeks?latest=1`);
  assert.equal(week.ready, 6);
  f.sqlite.close();
});

test('demo accounts replay onboarding, styles, week plan and artwork from the prepared pack', async t => {
  const f = await seeded({ ready: false }), clinic = DEMO_CLINICS[0], ids = demoIds(clinic), A = ids.account;
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { providerCalls++; return Response.json({ data: [{ b64_json: f.png.toString('base64') }] }); });
  // Onboarding starts with details and logo already in place.
  let { clinic: c } = await f.call(A, `/clinics/${ids.clinic}`);
  assert.equal(c.status, 'onboarding');
  assert.ok(c.brand.logoAssetId);
  c = (await f.call(A, `/clinics/${c.id}/profile`, 'PUT', { revision: c.revision, confirmed: true, services: c.profile.services })).clinic;
  await f.call(A, `/clinics/${c.id}/styles`, 'POST', {});
  await f.drain();
  const { styles } = await f.call(A, `/clinics/${c.id}`);
  assert.deepEqual(styles.map(s => [s.status, s.name]), clinic.styles.map(s => ['ready', s.name]));
  const style = await f.call(A, `/assets/${styles[0].asset_id}/preview`);
  assert.equal(style.headers.get('Content-Type'), 'image/webp');
  await f.call(A, `/clinics/${c.id}/style-selection`, 'PUT', { primaryStyleId: styles[0].id, secondaryStyleIds: [styles[1].id, styles[2].id] });
  // Planning shows the prepared copy straight away; creating images replays the pack.
  let { week } = await f.call(A, `/clinics/${c.id}/weeks`, 'POST', {});
  assert.deepEqual(week.items.map(i => i.topic), clinic.items.map(i => i.topic));
  assert.ok(week.items.every(i => i.copy_status === 'approved' && i.brief.prepared && i.frames.every(fr => !fr.assetId)));
  await f.call(A, `/weeks/${week.id}/generate`, 'POST', { stage: 'images' });
  await f.drain();
  ({ week } = await f.call(A, `/weeks/${week.id}`));
  assert.equal(week.ready, 6);
  assert.equal(providerCalls, 1, 'only the live post calls the image provider');
  const live = week.items.find(i => i.topic === clinic.items.find(x => x.live).topic);
  const prepared = week.items.find(i => i !== live);
  assert.match(f.sqlite.prepare('SELECT preview_key FROM v4_assets WHERE id=?').get(prepared.frames[0].assetId).preview_key, /\/demo\//);
  assert.doesNotMatch(f.sqlite.prepare('SELECT preview_key FROM v4_assets WHERE id=?').get(live.frames[0].assetId).preview_key, /\/demo\//);
  // Replayed images cost nothing; the live post costs one normal generation.
  assert.equal(f.sqlite.prepare('SELECT SUM(amount) n FROM credit_ledger WHERE account_id=?').get(A).n, DEMO_CREDITS - 10);
  f.sqlite.close();
});

test('regular accounts never receive the demo week', async () => {
  const { demoClinicFor } = await import('../server/v4/demo-clinics.mjs');
  assert.equal(demoClinicFor('A'), null);
  assert.equal(demoClinicFor('demo-acct-nobody'), null);
  assert.equal(demoClinicFor('demo-acct-rosebay').name, 'Rosebay Family Dental');
});
