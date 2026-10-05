import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {createPostpilot} from '../server/v4/postpilot.mjs';
import {postpilotRoute} from '../server/v4/postpilot-route.mjs';
import {publishingPanel} from '../web/v4/postpilot.js';

test('multipart upload preserves ranges and only sends bearer credentials to PostPilot',async()=>{
 const puts=[];const calls=[];
 const client=createPostpilot({baseUrl:'https://postpilot.test',apiKey:'ppk_secret',fetcher:async(url,opts)=>{
  calls.push({url,opts});
  if(url==='https://media.test/signed'){puts.push(opts);return new Response('',{headers:{etag:'"receipt"'}});}
  assert.equal(opts.headers.Authorization,'Bearer ppk_secret');
  if(url.endsWith('/uploads'))return Response.json({id:'upload',partSize:3,parts:3});
  if(url.endsWith('/parts'))return Response.json({url:'https://media.test/signed',local:false});
  if(url.endsWith('/complete'))return Response.json({id:'media'});
  throw Error(url);
 }});
 assert.equal((await client.upload({bytes:new Uint8Array([1,2,3,4,5,6,7]),mime:'image/png'},'slide.png')).id,'media');
 assert.deepEqual(puts.map(p=>[...p.body]),[[1,2,3],[4,5,6],[7]]);assert.ok(puts.every(p=>!p.headers.Authorization));
 assert.deepEqual(JSON.parse(calls.at(-1).opts.body).parts,[1,2,3].map(partNumber=>({partNumber,etag:'receipt'})));
});
test('local multipart uses bearer token and upload failures abort reservations',async()=>{
 let aborted=false;
 const client=createPostpilot({baseUrl:'https://postpilot.test',apiKey:'key',fetcher:async(url,opts)=>{
  if(url.endsWith('/uploads'))return Response.json({id:'u',partSize:8});
  if(url.endsWith('/parts'))return Response.json({url:'/local-upload',local:true});
  if(url.endsWith('/local-upload')){assert.equal(opts.headers.Authorization,'Bearer key');return new Response('',{status:500});}
  if(url.endsWith('/abort')){aborted=true;return Response.json({});}throw Error(url);
 }});
 await assert.rejects(client.upload({bytes:new Uint8Array([1]),mime:'image/png'},'slide'),/upload failed/);assert.ok(aborted);
});
function fixture(){
 const sqlite=new Database(':memory:');sqlite.exec(readFileSync('cloudflare/migrations/0015_postpilot.sql','utf8'));
 sqlite.exec('CREATE TABLE v4_assets(id TEXT,account_id TEXT,clinic_id TEXT,original_key TEXT,mime TEXT); CREATE TABLE v4_usage(id TEXT PRIMARY KEY,account_id TEXT,clinic_id TEXT,content_id TEXT,knowledge_card_id TEXT,angle_id TEXT,recipe_id TEXT,region TEXT,headline TEXT,status TEXT,generated_at TEXT);');
 for(const n of [1,2])sqlite.prepare('INSERT INTO v4_assets VALUES(?,?,?,?,?)').run('asset'+n,'A','clinic','key'+n,'image/png');
 const db={prepare(sql){return {bind(...args){const statement=sqlite.prepare(sql);return {first:async()=>statement.get(...args),run:async()=>({meta:statement.run(...args)})};}}}};
 const calls=[];let remote={id:'post',status:'draft'},ambiguous=false,uploadCount=0;
 const connection={readiness:async()=>({account:{username:'clinic_instagram'}}),upload:async(image,name)=>{uploadCount++;return {id:name};},request:async(path,opts)=>{
  calls.push({path,opts});if(path==='/api/posts'){if(ambiguous)throw Error('Timeout');return remote;}
  if(path.endsWith('/publish')||path.endsWith('/retry'))remote={id:'post',status:'publishing'};
  if(opts?.method==='PUT')remote={id:'post',status:'scheduled',scheduledFor:opts.body.scheduledFor};
  return remote;
 }};
 const platform={db,postpilot:()=>connection,readImage:async()=>({bytes:new Uint8Array([1]),mime:'image/png'})};
 const item={id:'content',revision:1,type:'carousel',status:'approved',topic:'Dental care',caption:'Clinic caption',knowledge_card_id:'card',angle_id:'angle',recipe_id:'recipe',frames:[{position:2,assetId:'asset2'},{position:1,assetId:'asset1'}]};
 const clinic={id:'clinic',profile:{location:'Kochi'}};
 const call=async(input)=>postpilotRoute({platform,account:'A',item,clinic,request:new Request('https://studio.test/api/v4/content/content/postpilot',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
 return {sqlite,calls,call,item,platform,uploads:()=>uploadCount,setRemote:v=>remote=v,setAmbiguous:()=>ambiguous=true};
}
test('publication creates a draft, saves its ID, preserves slide order and never repeats publication',async()=>{
 const f=fixture();try{
 const result=await f.call({action:'publish'});assert.equal(result.delivery.status,'publishing');assert.equal(f.uploads(),2);
 const payload=f.calls.find(c=>c.path==='/api/posts').opts.body;assert.equal(payload.action,'draft');assert.equal(payload.mediaId,'slide-1.png');assert.deepEqual(payload.carouselMediaIds,['slide-2.png']);assert.equal(payload.caption,'Clinic caption');
 await f.call({action:'publish'});assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,1);assert.equal(f.uploads(),2);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM v4_usage').get().n,0);
 f.setRemote({id:'post',status:'published',targetStatuses:{instagram:'success'}});await f.call();await f.call();assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM v4_usage').get().n,1);
 }finally{f.sqlite.close();}
});
test('scheduling uses UTC, rejects past dates and requires approved artwork',async()=>{
 const f=fixture();try{
 await assert.rejects(f.call({action:'schedule',scheduledFor:'2000-01-01T00:00:00Z'}),/future/);
 f.item.status='ready';await assert.rejects(f.call({action:'publish'}),/Approve/);f.item.status='approved';
 const date=new Date(Date.now()+3600000).toISOString();const result=await f.call({action:'schedule',scheduledFor:date});assert.equal(result.delivery.status,'scheduled');
 assert.equal(f.calls.find(c=>c.opts?.method==='PUT').opts.body.scheduledFor,date);assert.equal(f.calls.filter(c=>c.path.endsWith('/publish')).length,0);
 f.item.revision=2;await assert.rejects(f.call({action:'publish'}),/changed/);
 }finally{f.sqlite.close();}
});
test('ambiguous draft creation blocks repeated sends and concurrent sends acquire a single lock',async()=>{
 const f=fixture();try{
 f.setAmbiguous();await assert.rejects(f.call({action:'publish'}),/Timeout/);await assert.rejects(f.call({action:'publish'}),/needs review/);assert.equal(f.calls.filter(c=>c.path==='/api/posts').length,1);
 }finally{f.sqlite.close();}
 const g=fixture();try{
 const results=await Promise.allSettled([g.call({action:'publish'}),g.call({action:'publish'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(g.uploads(),2);
 }finally{g.sqlite.close();}
});
test('publishing panel requires approval and displays status and schedule timezone',()=>{
 const item={status:'ready',frames:[{},{}]};assert.match(publishingPanel(item,null),/disabled/);
 item.status='approved';const html=publishingPanel(item,{configured:true,account:{username:'clinic'},delivery:null});assert.match(html,/Publish now/);assert.match(html,/Schedule for later/);assert.match(html,/Time zone:/);
 assert.doesNotMatch(publishingPanel(item,{configured:true,delivery:{status:'publishing'}}),/data-form="postpilot"/);
});

test('PostPilot API redirects fail without following or forwarding credentials',async()=>{
 const calls=[];
 const client=createPostpilot({baseUrl:'https://postpilot.test',apiKey:'ppk_secret',fetcher:async(url,opts)=>{
  assert.notEqual(opts.redirect,'error','Cloudflare Workers does not support redirect:error');
  calls.push({url,opts});return new Response(null,{status:302,headers:{Location:'https://other.test'}});
 }});
 await assert.rejects(client.readiness(),/PostPilot request failed \(302\)/);
 assert.equal(calls.length,1);assert.equal(calls[0].opts.redirect,'manual');
});

test('signed upload redirects abort without following the redirected URL',async()=>{
 let aborted=false;
 const client=createPostpilot({baseUrl:'https://postpilot.test',apiKey:'ppk_secret',fetcher:async(url,opts)=>{
  assert.notEqual(opts.redirect,'error');
  if(url.endsWith('/uploads'))return Response.json({id:'u',partSize:8});
  if(url.endsWith('/parts'))return Response.json({url:'https://media.test/signed',local:false});
  if(url==='https://media.test/signed'){assert.equal(opts.redirect,'manual');return new Response(null,{status:307,headers:{Location:'https://other.test'}});}
  if(url.endsWith('/abort')){aborted=true;return Response.json({});}throw Error(url);
 }});
 await assert.rejects(client.upload({bytes:new Uint8Array([1]),mime:'image/png'},'slide'),/upload failed/);
 assert.ok(aborted);
});
