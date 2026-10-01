import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { apiRoute, getProject } from '../../cloudflare/studio.mjs';
import { companionRoute, enqueueCompanion, enqueueCompanionStyle, companionStyleResult } from '../../cloudflare/companion.mjs';

function fixture() {
  const sqlite = new Database(':memory:');
  for (const name of ['0001_accounts_credits.sql','0002_studio.sql','0003_manual_plans.sql','0004_job_corrections.sql','0005_template_imports.sql','0006_companion.sql','0007_companion_images.sql','0008_companion_styles.sql']) sqlite.exec(readFileSync(`cloudflare/migrations/${name}`,'utf8'));
  const DB = { prepare(sql) { return { bind(...args) { const statement=sqlite.prepare(sql); return {first:async()=>statement.get(...args),all:async()=>({results:statement.all(...args)}),run:async()=>({meta:statement.run(...args)}),execute:()=>({meta:statement.run(...args)})}; } }; }, batch(stmts) { return Promise.resolve(sqlite.transaction(()=>stmts.map(s=>s.execute()))()); } };
  sqlite.exec("INSERT INTO accounts(id,name,companion_enabled) VALUES('a','Test',1); INSERT INTO users(id,identity_provider,identity_subject,email) VALUES('u','test','u','user@example.com'); INSERT INTO memberships(account_id,user_id,role) VALUES('a','u','owner'); INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES('c','a','Clinic','dental','{}','{}','2026-09-28','2026-09-28');");
  return {sqlite,env:{DB,APP_ORIGIN:'https://test.example'},viewer:{account_id:'a',user_id:'u',email:'user@example.com'}};
}
const route=(env,viewer,path,method='GET',body,token)=>{const url=new URL(`https://test.example/api/companion${path}`);return companionRoute(new Request(url,{method,headers:token?{Authorization:`Bearer ${token}`}:{},body:body?JSON.stringify(body):undefined}),env,viewer,url);};
const caps={codex:{installed:true,ready:true,version:'1',detail:'Ready',models:[{id:'gpt-6-sol',label:'GPT-6 Sol'}],imageModels:[{id:'imagegen',label:'Codex ImageGen'}]},antigravity:{installed:false,ready:false,version:'',detail:'Not found',models:[],imageModels:[]}};

test('companion leases five jobs from the same provider concurrently',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  for(let i=0;i<6;i++) await enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',idempotencyKey:crypto.randomUUID()});
  const leases=[];
  for(let i=0;i<5;i++) leases.push((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job);
  assert.equal(new Set(leases.map(job=>job.id)).size,5);
  assert.equal((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job,null);
  await route(env,null,`/jobs/${leases[0].id}/complete`,'POST',{lease:leases[0].lease,error:'generation_failed'},device.token);
  assert.ok((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job);
  sqlite.close();
});

test('flagged account pairs, polls, completes a draft and can revoke device',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  assert.ok(device.token);
  assert.equal((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job,null);
  const url=new URL('https://test.example/api/clients/c/projects');
  const created=await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Brush gently'})}),env,viewer,url);
  const project=(await created.json()).project;
  project.language='malayalam-english';
  const queued=await enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',idempotencyKey:crypto.randomUUID()});
  assert.equal(queued.job.quotedCredits,0);
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  assert.equal(job.task,'draft');assert.match(job.input.prompt,/Brush gently/);
  assert.match(job.input.prompt,/Malayalam words must use Malayalam script; English words stay in Latin script/);
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

test('selected local model is delivered to the companion',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  await assert.rejects(()=>enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',model:'unknown',idempotencyKey:crypto.randomUUID()}),{status:409});
  await enqueueCompanion(env,viewer,project,{stage:'draft',provider:'codex',model:'gpt-6-sol',idempotencyKey:crypto.randomUUID()});
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  assert.equal(job.input.model,'gpt-6-sol');
  sqlite.close();
});

for (const model of ['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','imagegen']) test(`local image model ${model} receives its reference and saves generated artwork`,async()=>{
  const imageCaps = structuredClone(caps);
  imageCaps.codex.imageModels.push(...['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].map(id=>({id,label:id})));
  const {sqlite,env,viewer}=fixture();
  const objects=new Map();
  env.STATIC={fetch:async()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}})};
  env.ASSETS={put:async(key,bytes)=>objects.set(key,bytes),get:async(key)=>objects.has(key)?{arrayBuffer:async()=>objects.get(key)}:null,delete:async(key)=>objects.delete(key)};
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',imageCaps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  const data=JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(project.id).project_json);
  data.templateId='builtin:dental:neutral:1.0.0';
  data.slides[0].approved=true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(data),project.id);
  const current=await getProject(env,'a','c',project.id);
  await assert.rejects(()=>enqueueCompanion(env,viewer,current,{stage:'image',slideIndex:0,provider:'codex',model:'gpt-6-sol',idempotencyKey:crypto.randomUUID()}),{status:400});
  await route(env,null,'/poll','POST',caps,device.token);
  if (model !== 'imagegen') await assert.rejects(()=>enqueueCompanion(env,viewer,current,{stage:'image',slideIndex:0,provider:'codex',model,idempotencyKey:crypto.randomUUID()}),{status:409});
  await route(env,null,'/poll','POST',imageCaps,device.token);
  await enqueueCompanion(env,viewer,current,{stage:'image',slideIndex:0,provider:'codex',model,idempotencyKey:crypto.randomUUID()});
  const job=(await (await route(env,null,'/poll','POST',imageCaps,device.token)).json()).job;
  assert.equal(job.task,'image');assert.equal(job.input.model,model);
  const refs=await (await route(env,null,`/jobs/${job.id}/references`,'POST',{lease:job.lease},device.token)).json();
  assert.equal(refs.references[0].name,'reference');
  const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
  assert.equal((await route(env,null,`/jobs/${job.id}/complete`,'POST',{lease:job.lease,result:{image}},device.token)).status,200);
  const saved=await getProject(env,'a','c',project.id);
  assert.ok(saved.slides[0].artworkAssetId);assert.equal(saved.slides[0].artworkProvider,'codex');assert.equal(objects.size,1);
  sqlite.close();
});

test('parallel local images keep both slides when completed in reverse order',async()=>{
  const {sqlite,env,viewer}=fixture();
  const objects=new Map();
  env.STATIC={fetch:async()=>new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}})};
  env.ASSETS={put:async(key,bytes)=>objects.set(key,bytes),get:async(key)=>objects.has(key)?{arrayBuffer:async()=>objects.get(key)}:null,delete:async(key)=>objects.delete(key)};
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const url=new URL('https://test.example/api/clients/c/projects');
  const project=(await (await apiRoute(new Request(url,{method:'POST',body:JSON.stringify({topic:'Topic'})}),env,viewer,url)).json()).project;
  const data=JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(project.id).project_json);
  data.templateId='builtin:dental:neutral:1.0.0';
  data.slides[0].approved=true;data.slides[1].approved=true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(data),project.id);
  const current=await getProject(env,'a','c',project.id);
  for(let i=0;i<2;i++) await enqueueCompanion(env,viewer,current,{stage:'image',slideIndex:i,provider:'codex',model:'imagegen',idempotencyKey:crypto.randomUUID()});
  const jobs=[];
  for(let i=0;i<2;i++) jobs.push((await (await route(env,null,'/poll','POST',caps,device.token)).json()).job);
  const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
  for(const job of jobs.reverse()) assert.equal((await route(env,null,`/jobs/${job.id}/complete`,'POST',{lease:job.lease,result:{image}},device.token)).status,200);
  const saved=await getProject(env,'a','c',project.id);
  assert.ok(saved.slides[0].artworkAssetId);
  assert.ok(saved.slides[1].artworkAssetId);
  assert.notEqual(saved.slides[0].artworkAssetId,saved.slides[1].artworkAssetId);
  sqlite.close();
});

test('companion receives selected format and cannot attach artwork after a format change', async () => {
  const { sqlite, env, viewer } = fixture();
  const pair = await (await route(env, viewer, '/devices/pairing', 'POST', {})).json();
  const device = await (await route(env, null, '/pair', 'POST', { code: pair.code, name: 'Laptop' })).json();
  await route(env, null, '/poll', 'POST', caps, device.token);
  const url = new URL('https://test.example/api/clients/c/projects');
  const project = (await (await apiRoute(new Request(url, { method: 'POST', body: JSON.stringify({ topic: 'Story', templateId: 'builtin:dental:neutral:1.0.0', generation: { aspectRatio: '9:16' } }) }), env, viewer, url)).json()).project;
  const data = JSON.parse(sqlite.prepare('SELECT project_json FROM projects WHERE id=?').get(project.id).project_json);
  data.slides[0].approved = true;
  sqlite.prepare('UPDATE projects SET project_json=? WHERE id=?').run(JSON.stringify(data), project.id);
  const current = await getProject(env, 'a', 'c', project.id);
  await enqueueCompanion(env, viewer, current, { stage: 'image', slideIndex: 0, provider: 'codex', model: 'imagegen', idempotencyKey: crypto.randomUUID() });
  const job = (await (await route(env, null, '/poll', 'POST', caps, device.token)).json()).job;
  assert.equal(job.input.aspectRatio, '9:16');
  assert.match(job.input.prompt, /Required output aspect ratio: 9:16/);
  assert.doesNotMatch(job.input.prompt, /4:5/);
  const patchUrl = new URL(`https://test.example/api/clients/c/projects/${project.id}`);
  assert.equal((await apiRoute(new Request(patchUrl, { method: 'PATCH', body: JSON.stringify({ expectedRevision: current.revision, generation: { ...current.generation, aspectRatio: '1:1' } }) }), env, viewer, patchUrl)).status, 200);
  await assert.rejects(() => route(env, null, `/jobs/${job.id}/references`, 'POST', { lease: job.lease }, device.token), { status: 409 });
  const image = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10,1,2,3]).toString('base64');
  const response = await route(env, null, `/jobs/${job.id}/complete`, 'POST', { lease: job.lease, result: { image } }, device.token);
  assert.equal(response.status, 409);
  assert.equal((await getProject(env, 'a', 'c', project.id)).slides[0].artworkAssetId, '');
  sqlite.close();
});

test('companion style generation leases without a carousel and returns a private style reference',async()=>{
  const {sqlite,env,viewer}=fixture();
  const pair=await (await route(env,viewer,'/devices/pairing','POST',{})).json();
  const device=await (await route(env,null,'/pair','POST',{code:pair.code,name:'Laptop'})).json();
  await route(env,null,'/poll','POST',caps,device.token);
  const objects=new Map();
  env.ASSETS={put:async(k,bytes)=>objects.set(k,bytes), get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k)}:null};
  const references=[{name:'reference',mime:'image/png',data:Buffer.alloc(70000,1).toString('base64')}];
  const result=await enqueueCompanionStyle(env,viewer,{id:'c'},{provider:'codex',model:'imagegen',prompt:'Create a square style',aspectRatio:'1:1',references});
  assert.equal(result.job.quotedCredits,0);
  const job=(await (await route(env,null,'/poll','POST',caps,device.token)).json()).job;
  assert.equal(job.task,'image');assert.equal(job.input.aspectRatio,'1:1');assert.equal(job.input.references,undefined);
  assert.equal(sqlite.prepare('SELECT project_id FROM companion_jobs WHERE id=?').get(job.id).project_id,null);
  const refs=await (await route(env,null,`/jobs/${job.id}/references`,'POST',{lease:job.lease},device.token)).json();
  assert.deepEqual(refs.references,references);
  const image='data:image/png;base64,'+Buffer.from('generated square style').toString('base64');
  assert.equal((await route(env,null,`/jobs/${job.id}/complete`,'POST',{lease:job.lease,result:{image}},device.token)).status,200);
  const saved=await companionStyleResult(env,'a','c',job.id);
  assert.equal(saved.image,image);assert.equal(saved.job.status,'succeeded');
  await assert.rejects(companionStyleResult(env,'a','other-client',job.id),{status:404});
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0);
  sqlite.close();
});
