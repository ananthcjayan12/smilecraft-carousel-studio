import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sampleRequestRoute,sampleLead,instagramHandle,adminLeadsRoute} from '../server/sample-request.mjs';

// D1-shaped wrapper over an in-memory SQLite database with the real migration applied.
function d1(){const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../cloudflare/migrations/0014_sample_requests.sql',import.meta.url),'utf8'));return {raw,prepare(sql){return {bind(...args){const s=raw.prepare(sql);return {first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)})}}}}}}
const valid={name:'Dr Jane Lee',clinic:'River Dental',email:'Jane@RiverDental.com',instagram:'@riverdental',utm:{utm_source:'chatgpt',utm_campaign:'launch'}};
const call=(db,body,{headers={}}={})=>{const url=new URL('https://studio.test/api/public/sample-request');return sampleRequestRoute(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),url,{db,now:()=>Date.parse('2026-10-03T10:00:00Z')});};
const admin=(db,path,init)=>{const url=new URL(`https://studio.test${path}`);return adminLeadsRoute(new Request(url,init),url,db);};

test('Instagram handles are normalised from handles and profile URLs',()=>{
  assert.equal(instagramHandle('riverdental'),'@riverdental');
  assert.equal(instagramHandle('@river.dental_'),'@river.dental_');
  assert.equal(instagramHandle('https://www.instagram.com/riverdental/?hl=en'),'@riverdental');
  for(const bad of ['','@','river dental','https://evil.test/riverdental','=HYPERLINK("x")'])assert.equal(instagramHandle(bad),'');
});

test('leads are cleaned and keep their campaign source',()=>{
  assert.deepEqual(sampleLead(valid,new Date('2026-10-03T10:00:00Z')),{createdAt:'2026-10-03T10:00:00.000Z',name:'Dr Jane Lee',clinic:'River Dental',email:'jane@riverdental.com',instagram:'@riverdental',utm_source:'chatgpt',utm_medium:'',utm_campaign:'launch',utm_content:''});
});

test('valid requests are saved once, and repeats keep the original lead',async()=>{
  const db=d1();
  assert.equal((await call(db,valid)).status,201);
  assert.equal((await call(db,{...valid,name:'Jane again'})).status,201);
  const rows=db.raw.prepare('SELECT * FROM sample_requests').all();
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'Dr Jane Lee');assert.equal(rows[0].email,'jane@riverdental.com');assert.equal(rows[0].utm_source,'chatgpt');assert.equal(rows[0].status,'New');
});

test('invalid, cross-site and bot requests are not saved',async()=>{
  const db=d1();
  assert.equal((await call(db,{...valid,instagram:''})).status,400);
  assert.equal((await call(db,{...valid,email:'not-an-email'})).status,400);
  assert.equal((await call(db,valid,{headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await call(db,{...valid,company:'Spam Inc'})).status,200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sample_requests').get().n,0);
});

test('database failures are reported to the visitor instead of looking successful',async()=>{
  const response=await call({prepare(){throw Error('D1 unavailable')}},valid);
  assert.equal(response.status,500);
  assert.match((await response.json()).error,/could not save/);
});

test('the administrator lists leads newest first and updates status and notes',async()=>{
  const db=d1();await call(db,valid);
  const url=new URL('https://studio.test/api/public/sample-request');
  await sampleRequestRoute(new Request(url,{method:'POST',body:JSON.stringify({...valid,email:'a@b.co',clinic:'Second'})}),url,{db,now:()=>Date.parse('2026-10-04T10:00:00Z')});
  const list=await (await admin(db,'/api/admin/leads',{method:'GET'})).json();
  assert.deepEqual(list.leads.map(l=>l.clinic),['Second','River Dental']);
  assert.ok(list.statuses.includes('Sample sent'));
  const id=list.leads[1].id;
  const updated=await (await admin(db,`/api/admin/leads/${id}`,{method:'PATCH',body:JSON.stringify({status:'Contacted',notes:'Called\nSends logo Friday'})})).json();
  assert.equal(updated.lead.status,'Contacted');assert.equal(updated.lead.notes,'Called\nSends logo Friday');
  await assert.rejects(admin(db,`/api/admin/leads/${id}`,{method:'PATCH',body:JSON.stringify({status:'Bogus'})}),/Unknown lead status/);
  await assert.rejects(admin(db,'/api/admin/leads/missing',{method:'PATCH',body:JSON.stringify({status:'New'})}),/Lead not found/);
});

test('only the administrator can read or change leads',async()=>{
  const {apiRoute}=await import('../cloudflare/studio.mjs');
  const env={DB:d1(),ADMIN_EMAIL:'owner@srshti.test'},url=new URL('https://studio.test/api/admin/leads');
  assert.equal((await apiRoute(new Request(url),env,{account_id:'A',email:'clinic@example.com'},url)).status,403);
  assert.equal((await apiRoute(new Request(url),env,{account_id:'B',email:'Owner@srshti.test'},url)).status,200);
});
