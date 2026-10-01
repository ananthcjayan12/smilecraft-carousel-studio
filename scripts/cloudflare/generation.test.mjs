import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { apiRoute, getProject } from '../../cloudflare/studio.mjs';
import { runJob, consumeJob, cancelJob } from '../../cloudflare/generation.mjs';

function fixture() {
  const sqlite = new Database(':memory:');
  for (const name of ['0001_accounts_credits.sql', '0002_studio.sql', '0003_manual_plans.sql', '0004_job_corrections.sql']) sqlite.exec(readFileSync(`cloudflare/migrations/${name}`, 'utf8'));
  const DB = {
    prepare(sql) {
      return { bind(...params) {
        const statement = sqlite.prepare(sql);
        return {
          first: async () => statement.get(...params),
          all: async () => ({ results: statement.all(...params) }),
          run: async () => ({ meta: statement.run(...params) }),
          execute: () => ({ meta: statement.run(...params) })
        };
      } };
    },
    batch(statements) { return Promise.resolve(sqlite.transaction(() => statements.map(statement => statement.execute()))()); }
  };
  sqlite.exec("INSERT INTO accounts(id,name) VALUES('a','Test'); INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES('c','a','Test Brand','general','{}','{}','2026-09-28','2026-09-28'); INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('grant','a',3,'manual_plan','month');");
  const messages = [];
  const env = { DB, APP_ORIGIN: 'https://test.example', OPENAI_API_KEY: 'test-key', GENERATION: { send: async message => messages.push(message) } };
  return { sqlite, env, messages };
}

async function project(env) {
  const response = await apiRoute(new Request('https://test.example/api/clients/c/projects', { method: 'POST', body: JSON.stringify({ topic: 'A useful tip' }) }), env, { account_id: 'a' }, new URL('https://test.example/api/clients/c/projects'));
  assert.equal(response.status, 201);
  return (await response.json()).project;
}

test('queued draft reserves once and settles credits with the saved project', async () => {
  const { sqlite, env, messages } = fixture();
  const p = await project(env);
  const draftData = JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(p.id).project_json);
  draftData.language = 'malayalam-english';
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(draftData), p.id);
  const input = { stage: 'draft', provider: 'openai', model: 'gpt-5.6-sol', idempotencyKey: crypto.randomUUID() };
  const queued = await runJob(env, 'a', 'c', p, input);
  assert.equal(queued.job.status, 'queued');
  assert.deepEqual(await runJob(env, 'a', 'c', p, input), { job: { ...queued.job, error: '', createdAt: sqlite.prepare('SELECT created_at FROM generation_jobs WHERE id=?').get(queued.job.id).created_at } });
  assert.equal(messages.length, 1);
  assert.equal(sqlite.prepare("SELECT SUM(amount) AS amount FROM credit_reservations WHERE status='reserved'").get().amount, 2);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.match(JSON.parse(options.body).messages[0].content, /Malayalam words must use Malayalam script; English words stay in Latin script/);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ slides: Array.from({ length: 5 }, (_, i) => ({ heading: `Slide ${i + 1}`, body: 'Useful information', visualPrompt: 'Clean illustration' })), instagram: 'Caption', facebook: 'Caption', youtubeTitle: 'Video', youtubeDescription: 'Description' }) } }] });
  };
  try { await consumeJob(env, queued.job.id); } finally { globalThis.fetch = originalFetch; }
  assert.equal(sqlite.prepare('SELECT status,error FROM generation_jobs WHERE id=?').get(queued.job.id).status, 'succeeded');
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS amount FROM credit_ledger WHERE account_id=?').get('a').amount, 1);
  assert.equal(sqlite.prepare('SELECT status FROM credit_reservations WHERE job_id=?').get(queued.job.id).status, 'settled');
  assert.equal((await getProject(env, 'a', 'c', p.id)).slides[0].heading, 'Slide 1');
  assert.equal((await cancelJob(env,'a',p.id,queued.job.id)).job.status,'succeeded');
  assert.equal(sqlite.prepare('SELECT status FROM credit_reservations WHERE job_id=?').get(queued.job.id).status,'settled');
  sqlite.close();
});

test('failed provider request releases reserved credits', async () => {
  const { sqlite, env } = fixture();
  const p = await project(env);
  const queued = await runJob(env, 'a', 'c', p, { stage: 'draft', provider: 'openai', model: 'gpt-5.6-sol', idempotencyKey: crypto.randomUUID() });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
  try { await consumeJob(env, queued.job.id); } finally { globalThis.fetch = originalFetch; }
  assert.equal(sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(queued.job.id).status, 'failed');
  assert.equal(sqlite.prepare('SELECT status FROM credit_reservations WHERE job_id=?').get(queued.job.id).status, 'released');
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS amount FROM credit_ledger WHERE account_id=?').get('a').amount, 3);
  sqlite.close();
});

test('image job stores private artwork and charges after attaching it to the slide', async () => {
  const { sqlite, env } = fixture();
  sqlite.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('image-grant','a',20,'manual_plan','image-month')").run();
  const p = await project(env);
  const current = sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(p.id);
  const value = JSON.parse(current.project_json);
  value.slides[0].approved = true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(value), p.id);
  const objects = new Map();
  env.STATIC = { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } }) };
  env.ASSETS = { put: async (key, bytes) => objects.set(key, bytes), delete: async key => objects.delete(key) };
  const refreshed = await getProject(env, 'a', 'c', p.id);
  const queued = await runJob(env, 'a', 'c', refreshed, { stage: 'image', slideIndex: 0, provider: 'openai', model: 'gpt-image-2', correction: 'Brighter colors', idempotencyKey: crypto.randomUUID() });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.body.get('prompt').includes('Brighter colors'), true);
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
  };
  try { await consumeJob(env, queued.job.id); } finally { globalThis.fetch = originalFetch; }
  const finalJob = sqlite.prepare('SELECT status,error FROM generation_jobs WHERE id=?').get(queued.job.id);
  assert.equal(finalJob.status, 'succeeded', finalJob.error);
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS amount FROM credit_ledger WHERE account_id=?').get('a').amount, 13);
  assert.equal(objects.size, 1);
  assert.ok((await getProject(env, 'a', 'c', p.id)).slides[0].artworkAssetId);
  sqlite.close();
});

test('parallel hosted image jobs preserve both slides and settle both reservations', async () => {
  const { sqlite, env } = fixture();
  sqlite.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('parallel-grant','a',30,'manual_plan','parallel-month')").run();
  const p = await project(env);
  const value = JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(p.id).project_json);
  value.slides[0].approved = true;
  value.slides[1].approved = true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(value), p.id);
  const objects = new Map();
  env.STATIC = { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } }) };
  env.ASSETS = { put: async (key, bytes) => objects.set(key, bytes), delete: async key => objects.delete(key) };
  const current = await getProject(env, 'a', 'c', p.id);
  const jobs = await Promise.all([0, 1].map(slideIndex => runJob(env, 'a', 'c', current, { stage: 'image', slideIndex, provider: 'openai', model: 'gpt-image-2', idempotencyKey: crypto.randomUUID() })));
  let started = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (++started === 2) release();
    await gate;
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
  };
  try { await Promise.all(jobs.map(({ job }) => consumeJob(env, job.id))); }
  finally { globalThis.fetch = originalFetch; }
  const saved = await getProject(env, 'a', 'c', p.id);
  assert.ok(saved.slides[0].artworkAssetId);
  assert.ok(saved.slides[1].artworkAssetId);
  assert.notEqual(saved.slides[0].artworkAssetId, saved.slides[1].artworkAssetId);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM generation_jobs WHERE status='succeeded'").get().n, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM credit_reservations WHERE status='settled'").get().n, 2);
  sqlite.close();
});


test('cancel endpoint prevents queued provider calls, releases credits once, and scopes ownership', async () => {
  const { sqlite, env } = fixture();
  const p = await project(env);
  const {job} = await runJob(env, 'a', 'c', p, {stage:'draft',provider:'openai',model:'gpt-5.6-sol',idempotencyKey:crypto.randomUUID()});
  assert.equal(await cancelJob(env, 'another-account', p.id, job.id), null);
  assert.equal(await cancelJob(env, 'a', 'another-project', job.id), null);
  const url = new URL(`https://test.example/api/clients/c/projects/${p.id}/jobs/${job.id}`);
  for (let i=0;i<2;i++) {
    const response = await apiRoute(new Request(url,{method:'DELETE'}),env,{account_id:'a'},url);
    assert.equal(response.status,200);
    assert.equal((await response.json()).job.status,'cancelled');
  }
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail('Cancelled queued job reached provider'); };
  try { await consumeJob(env,job.id); } finally { globalThis.fetch=original; }
  assert.equal(sqlite.prepare('SELECT status FROM credit_reservations WHERE job_id=?').get(job.id).status,'released');
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS n FROM credit_ledger').get().n,3);
  sqlite.close();
});

test('Stop aborts an active provider connection and keeps project and balance unchanged', async () => {
  const { sqlite, env } = fixture();
  const p = await project(env);
  const {job} = await runJob(env,'a','c',p,{stage:'draft',provider:'openai',model:'gpt-5.6-sol',idempotencyKey:crypto.randomUUID()});
  const original = globalThis.fetch;
  let started, aborted = false;
  const ready = new Promise(resolve => { started=resolve; });
  globalThis.fetch = async (_url,{signal}) => new Promise((_resolve,reject) => {
    signal.addEventListener('abort',()=>{ aborted=true; reject(signal.reason); },{once:true});
    started();
  });
  try {
    const running=consumeJob(env,job.id);
    await ready;
    await cancelJob(env,'a',p.id,job.id);
    await running;
  } finally { globalThis.fetch=original; }
  assert.equal(aborted,true);
  assert.equal(sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(job.id).status,'cancelled');
  assert.equal((await getProject(env,'a','c',p.id)).revision,p.revision);
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS n FROM credit_ledger').get().n,3);
  sqlite.close();
});

test('cancellation racing with a provider result cannot attach or charge it', async () => {
  const { sqlite, env } = fixture();
  const p = await project(env);
  const {job} = await runJob(env,'a','c',p,{stage:'draft',provider:'openai',model:'gpt-5.6-sol',idempotencyKey:crypto.randomUUID()});
  const original = globalThis.fetch;
  globalThis.fetch=async()=>{
    await cancelJob(env,'a',p.id,job.id);
    return Response.json({choices:[{message:{content:JSON.stringify({slides:Array.from({length:5},()=>({heading:'New copy',body:'Body'}))})}}]});
  };
  try { await consumeJob(env,job.id); } finally { globalThis.fetch=original; }
  assert.equal((await getProject(env,'a','c',p.id)).revision,p.revision);
  assert.equal(sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(job.id).status,'cancelled');
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS n FROM credit_ledger').get().n,3);
  sqlite.close();
});

test('hosted image requests use saved output format for both API providers', async () => {
  const { sqlite, env } = fixture();
  sqlite.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('formats','a',200,'manual_plan','formats')").run();
  env.GEMINI_API_KEY = 'test';
  env.STATIC = { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } }) };
  env.ASSETS = { put: async () => {}, delete: async () => {} };
  const p = await project(env);
  const originalFetch = globalThis.fetch;
  try {
    for (const [ratio, size] of [['1:1', '1024x1024'], ['9:16', '864x1536'], ['16:9', '1536x864']]) {
      for (const provider of ['openai', 'gemini']) {
        const value = JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(p.id).project_json);
        value.generation.aspectRatio = ratio; value.slides[0].approved = true;
        sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(value), p.id);
        const current = await getProject(env, 'a', 'c', p.id);
        const queued = await runJob(env, 'a', 'c', current, { stage: 'image', slideIndex: 0, provider, model: provider === 'openai' ? 'gpt-image-2' : 'gemini-3.1-flash-image', idempotencyKey: crypto.randomUUID() });
        globalThis.fetch = async (_url, options) => {
          if (provider === 'openai') {
            assert.equal(options.body.get('size'), size);
            assert.ok(options.body.get('prompt').includes(`Required output aspect ratio: ${ratio}.`));
            return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
          }
          assert.equal(JSON.parse(options.body).response_format.aspect_ratio, ratio);
          return Response.json({ outputs: [{ type: 'image', mime_type: 'image/png', data: Buffer.alloc(1500, 1).toString('base64') }] });
        };
        await consumeJob(env, queued.job.id);
        const job = sqlite.prepare('SELECT status,error FROM generation_jobs WHERE id=?').get(queued.job.id);
        assert.equal(job.status, 'succeeded', job.error);
      }
    }
  } finally { globalThis.fetch = originalFetch; sqlite.close(); }
});

test('hosted format changes preserve copy and reject an in-flight image without charging credits', async () => {
  const { sqlite, env } = fixture();
  sqlite.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('format-race','a',20,'manual_plan','format-race')").run();
  env.STATIC = { fetch: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } }) };
  env.ASSETS = { put: async () => {}, delete: async () => {} };
  const p = await project(env);
  const value = JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(p.id).project_json);
  value.slides[0].approved = true; value.slides[0].artworkAssetId = 'old'; value.slides[0].artworkReviewed = true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(value), p.id);
  const current = await getProject(env, 'a', 'c', p.id);
  const queued = await runJob(env, 'a', 'c', current, { stage: 'image', slideIndex: 0, provider: 'openai', model: 'gpt-image-2', idempotencyKey: crypto.randomUUID() });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const url = new URL(`https://test.example/api/clients/c/projects/${p.id}`);
    const response = await apiRoute(new Request(url, { method: 'PATCH', body: JSON.stringify({ expectedRevision: current.revision, generation: { ...current.generation, aspectRatio: '9:16' } }) }), env, { account_id: 'a' }, url);
    assert.equal(response.status, 200);
    const changed = (await response.json()).project;
    assert.equal(changed.slides[0].approved, true);
    assert.equal(changed.slides[0].artworkAssetId, '');
    assert.equal(changed.slides[0].artworkReviewed, false);
    return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
  };
  try { await consumeJob(env, queued.job.id); } finally { globalThis.fetch = originalFetch; }
  assert.equal(sqlite.prepare('SELECT status FROM generation_jobs WHERE id=?').get(queued.job.id).status, 'failed');
  assert.equal(sqlite.prepare('SELECT status FROM credit_reservations WHERE job_id=?').get(queued.job.id).status, 'released');
  assert.equal((await getProject(env, 'a', 'c', p.id)).slides[0].artworkAssetId, '');
  assert.equal(sqlite.prepare('SELECT SUM(amount) AS amount FROM credit_ledger WHERE account_id=?').get('a').amount, 23);
  sqlite.close();
});
