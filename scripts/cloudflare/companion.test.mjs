import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { apiRoute, getProject } from '../../cloudflare/studio.mjs';
import { companionRoute, enqueueCompanion } from '../../cloudflare/companion.mjs';

function fixture() {
  const sqlite = new Database(':memory:');
  for (const name of ['0001_accounts_credits.sql','0002_studio.sql','0003_manual_plans.sql','0004_job_corrections.sql','0005_template_imports.sql','0006_companion.sql']) sqlite.exec(readFileSync(`cloudflare/migrations/${name}`,'utf8'));
  const DB = { prepare(sql) { return { bind(...args) { const statement=sqlite.prepare(sql); return {first:async()=>statement.get(...args),all:async()=>({results:statement.all(...args)}),run:async()=>({meta:statement.run(...args)}),execute:()=>({meta:statement.run(...args)})}; } }; }, batch(stmts) { return Promise.resolve(sqlite.transaction(()=>stmts.map(s=>s.execute()))()); } };
  sqlite.exec("INSERT INTO accounts(id,name,companion_enabled) VALUES('a','Test',1); INSERT INTO users(id,identity_provider,identity_subject,email) VALUES('u','test','u','user@example.com'); INSERT INTO memberships(account_id,user_id,role) VALUES('a','u','owner'); INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES('c','a','Clinic','dental','{}','{}','2026-09-28','2026-09-28');");
  return {sqlite,env:{DB,APP_ORIGIN:'https://test.example'},viewer:{account_id:'a',user_id:'u',email:'user@example.com'}};
}
const route=(env,viewer,path,method='GET',body,token)=>{const url=new URL(`https://test.example/api/companion${path}`);return companionRoute(new Request(url,{method,headers:token?{Authorization:`Bearer ${token}`}:{},body:body?JSON.stringify(body):undefined}),env,viewer,url);};
const caps={codex:{installed:true,ready:true,version:'1',detail:'Ready'},antigravity:{installed:false,ready:false,version:'',detail:'Not found'}};

test('flagged account pairs, polls, completes a draft and can revoke device',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  assert.ok(device.token);
  assert.equal((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job,null);
  const url=new URL('https://test.example/api/clients/c/projects');
  const created=await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Brush gently'})}),env,viewer,url);
  const project=(await created.json()).project;
  const queued=await enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',idempotencyKey:crypto.randomUUID()});
  assert.equal(queued.job.quotedCredits,0);
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  assert.equal(job.task,'draft');assert.match(job.input.prompt,/Brush gently/);
  assert.equal((await (await route(env,null,`/jobs/${job.id}/heartbeat`,'POST',{lease:job.lease},device.token)).json()).active,true);
  const result={slides:Array.from({length:5},(_,i)=>({heading:`Heading ${i}`,body:'Useful advice',visualPrompt:'Clean illustration'})),instagram:'Caption',facebook:'Caption',youtubeTitle:'Video',youtubeDescription:'Description'};
  assert.equal((await route(env,null,`/jobs/${job.id}/complete`,'POST',{lease:job.lease,result},device.token)).status,200);
  assert.equal((await getProject(env,'a','c',project.id)).slides[0].heading,'Heading 0');
  assert.equal(sqlite.prepare('SELECT status FROM companion_jobs WHERE id=?').get(job.id).status,'succeeded');
  assert.equal((await route(env,viewer,`/devices/${device.id}`,'DELETE')).status,200);
  await assert.rejects(()=>route(env,null,'/poll','POST',caps,device.token),{status:401});
  sqlite.close();
});

test('project revision change blocks stale local completion',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  await enqueueCompanion(env,viewer,project,{stage:'revise',slideIndex:0,provider:'codex',idempotencyKey:crypto.randomUUID()});
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  sqlite.prepare('UPDATE projects SET revision=revision+1 WHERE id=?').run(project.id);
  const response=await route(env,null,`/jobs/${job.id}/complete`,'POST',{lease:job.lease,result:{heading:'New',body:'Body',visualPrompt:'Image'}},device.token);
  assert.equal(response.status,409);
  assert.equal(sqlite.prepare('SELECT status FROM companion_jobs WHERE id=?').get(job.id).status,'failed');
  sqlite.close();
});

test('disabled account cannot create pairing codes or submit local writing',async()=>{
  const {sqlite,env,viewer}=fixture();
  sqlite.prepare('UPDATE accounts SET companion_enabled=0 WHERE id=?').run('a');
  assert.equal((await route(env,viewer,'/devices/pairing','POST',{})).status,403);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  await assert.rejects(()=>enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',idempotencyKey:crypto.randomUUID()}),{status:403});
  sqlite.close();
});

test('cancelling a leased job makes the next heartbeat inactive',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  await enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',idempotencyKey:crypto.randomUUID()});
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  const path=new URL(`https://test.example/api/clients/c/projects/${project.id}/jobs/${job.id}`);
  assert.equal((await apiRoute(new Request(path,{method:'DELETE'}),env,viewer,path)).status,200);
  assert.equal((await (await route(env,null,`/jobs/${job.id}/heartbeat`,'POST',{lease:job.lease},device.token)).json()).active,false);
  sqlite.close();
});
