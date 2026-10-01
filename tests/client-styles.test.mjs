import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { apiRoute } from '../cloudflare/studio.mjs';
import { buildV1StylePrompt } from '../cloudflare/prompts.mjs';

const dir = mkdtempSync(join(tmpdir(), 'client-styles-'));
process.env.STORAGE_ROOT = dir;
const store = await import('../server/store.mjs');

test.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });

test('local libraries contain only own styles and removal preserves existing projects', () => {
  const a = store.createClient({ name:'Salon A', businessPackId:'salon' });
  const b = store.createClient({ name:'Salon B', businessPackId:'salon' });
  assert.deepEqual(store.listTemplates(a.id, 'salon'), []);
  assert.equal(store.createProject(a.id).templateId, '');
  store.installTemplateRecords(a.id, [{id:'custom:style-a', packId:'custom-a', packVersion:'1.0.0', name:'Style A', businessPackId:'salon', mode:'slides', data:{slides:[]}, checksum:'a'}]);
  assert.deepEqual(store.listTemplates(b.id, 'salon'), []);
  assert.throws(() => store.removeTemplate(b.id, 'custom:style-a'), e => e.status === 404);
  const project = store.createProject(a.id);
  assert.equal(project.templateId, 'custom:style-a');
  store.removeTemplate(a.id, 'custom:style-a');
  assert.deepEqual(store.listTemplates(a.id, 'salon'), []);
  assert.equal(store.getTemplate(a.id, 'custom:style-a'), null);
  assert.equal(store.getProject(a.id, project.id).templateId, 'custom:style-a');
  store.installTemplateRecords(a.id, [{id:'custom:style-a', packId:'custom-a', packVersion:'1.0.0', name:'Style A', businessPackId:'salon', mode:'slides', data:{slides:[]}, checksum:'a'}]);
  assert.equal(store.listTemplates(a.id,'salon').length,1);
});

test('hosted libraries and deletion enforce both account and client ownership', async () => {
  const sqlite = new Database(':memory:');
  for (const name of ['0001_accounts_credits.sql','0002_studio.sql']) sqlite.exec(readFileSync(`cloudflare/migrations/${name}`, 'utf8'));
  sqlite.exec("INSERT INTO accounts(id,name) VALUES('a','A'),('b','B'); INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES('c','a','Salon','salon','{}','{}','now','now'),('d','a','Other Salon','salon','{}','{}','now','now'); INSERT INTO templates(id,account_id,client_id,name,business_pack_id,mode,data_json,created_at) VALUES('custom:one','a','c','One','salon','slides','{}','now');");
  const DB = {prepare(sql) {return {bind(...args) {const stmt=sqlite.prepare(sql); return {first:async()=>stmt.get(...args), all:async()=>({results:stmt.all(...args)}), run:async()=>({meta:stmt.run(...args)})};}};}};
  const request = async (account, client, path='', method='GET') => {
    const url=new URL(`https://example.test/api/clients/${client}/templates${path}`);
    return apiRoute(new Request(url,{method}),{DB},{account_id:account},url);
  };
  try {
    assert.equal((await (await request('a','c')).json()).templates.length,1);
    assert.deepEqual((await (await request('a','d')).json()).templates,[]);
    assert.equal((await request('a','d','/custom%3Aone','DELETE')).status,404);
    assert.equal((await request('b','c','/custom%3Aone','DELETE')).status,404);
    assert.equal((await request('a','c','/custom%3Aone','DELETE')).status,200);
    assert.deepEqual((await (await request('a','c')).json()).templates,[]);
  } finally {sqlite.close();}
});

test('variation prompt applies written requests to the complete image and treats red marks as editing instructions', () => {
  const prompt=buildV1StylePrompt({sourceTemplateId:'custom:one', brand:{name:'Salon',primary:'#123456',accent:'#654321'},businessType:'Salon',revisionNotes:'Slide 2: replace the marked photograph. Keep the footer.'});
  assert.match(prompt,/Slide 2: replace the marked photograph/);
  assert.match(prompt,/remove all red annotation strokes/);
  assert.match(prompt,/Preserve the complete composition/);
  assert.match(prompt,/Do not crop, cut up, rearrange or split/);
  assert.doesNotMatch(prompt,/cropped consistently|Place the five panels/);
  assert.doesNotMatch(prompt,/supplied dental board is inspiration/);
});
