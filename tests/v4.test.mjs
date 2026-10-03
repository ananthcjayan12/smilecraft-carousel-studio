import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFile} from 'node:fs/promises';
import {createV4Service,weekStart} from '../server/v4/service.mjs';
import {KNOWLEDGE_CARDS,makeCopy,rankCards,validateCopy} from '../server/v4/knowledge.mjs';
import {publicUrl,publicFetch,extractCandidates} from '../server/v4/extract.mjs';
import {mockContent,mockProviders} from './v4-fixtures.mjs';
const pipeline=await readFile(new URL('../cloudflare/migrations/0011_v4_content_pipeline.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../cloudflare/migrations/0009_srshti_v4.sql',import.meta.url),'utf8');
function fixture(){const sqlite=new Database(':memory:');sqlite.exec(migration+pipeline);const queued=[],assets=new Map();let brokenPosition=0,generated=0,active=true,rejectValidation=false;const textCalls=[],styleCalls=[];const queryLog=[];const db={prepare(sql){queryLog.push(sql);return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)}),execute:()=>stmt.reader?{results:stmt.all(...args)}:{results:[],meta:stmt.run(...args)}}}}}};const batchCalls=[];db.batch=async statements=>{batchCalls.push(statements.length);return sqlite.transaction(()=>statements.map(statement=>statement.execute()))();};const service=createV4Service({db,providerCatalog:async()=>mockProviders,generateText:async(input)=>{textCalls.push(input);if(input.schema.properties.valid&&rejectValidation)return {valid:false,issues:['Unsupported advice.']};return mockContent(input.prompt,input.schema);},capabilities:{demo:true},activation:async()=>({active}),requireActivation:async()=>{if(!active)throw Object.assign(Error('Awaiting activation'),{status:409})},enqueue:async id=>queued.push(id),saveImage:async(a,c,image)=>{const key=crypto.randomUUID();assets.set(key,{bytes:image.bytes,mime:image.mime});return {mime:image.mime,originalKey:key,previewKey:key,thumbnailKey:key,size:3}},readImage:async key=>assets.get(key),generateStyle:async(...args)=>{styleCalls.push(args);return {bytes:new Uint8Array([1,2,3]),mime:'image/png'}},generateFrame:async(c,item,frame)=>{generated++;if(frame.position===brokenPosition)throw Error('Simulated provider failure');await new Promise(r=>setTimeout(r,2));return {bytes:new Uint8Array([1,2,3]),mime:'image/png'}}});
 const call=async(path,method='GET',input,account='A')=>{const url=new URL(`https://studio.test/api/v4${path}`);const res=await service.route(new Request(url,{method,body:input===undefined?undefined:JSON.stringify(input),headers:input===undefined?{}:{'Content-Type':'application/json'}}),account,url);return res.json()};
 async function drain(){let count=0;while(queued.length){const group=queued.splice(0);await Promise.all(group.map(id=>service.consume(id)));if(++count>15)throw Error('Queue did not settle')}}
 async function setup(profile={}){const c=(await call('/clinics','POST',{name:'River Dental'})).clinic;await call(`/clinics/${c.id}/profile`,'PUT',{revision:c.revision,confirmed:true,services:['General dentistry'],name:c.name,...profile});await call(`/clinics/${c.id}/styles`,'POST',{});await drain();const data=await call(`/clinics/${c.id}`);assert.equal(data.styles.length,3);await call(`/clinics/${c.id}/style-selection`,'PUT',{primaryStyleId:data.styles[0].id,secondaryStyleIds:[data.styles[1].id]});const {week}=await call(`/clinics/${c.id}/weeks`,'POST',{});await drain();return {clinic:(await call(`/clinics/${c.id}`)).clinic,week:(await call(`/weeks/${week.id}`)).week}}
 return {sqlite,service,call,queued,drain,setup,queryLog,batchCalls,failFrame:n=>brokenPosition=n,setActive:v=>active=v,generated:()=>generated,textCalls,styleCalls,rejectValidation:v=>rejectValidation=v};}
test('V4 source-backed copy validates for every card, angle and format; unverified claims fail closed',()=>{const c={id:'c',name:'River Dental',brand:{},profile:{facts:[{text:'We are open on Sundays.',status:'imported'}]}};for(const card of KNOWLEDGE_CARDS)for(const angle of card.engagementAngles)for(const format of ['carousel','post','story']){const copy=makeCopy(card,angle,format,c);assert.deepEqual(validateCopy(copy.frames,copy.caption,card,c),{valid:true})}const card=KNOWLEDGE_CARDS[0],copy=makeCopy(card,card.engagementAngles[0],'post',c);for(const unsafe of ['Guaranteed painless care.','99% success.','We are open on Sundays.','Salt cures every tooth infection.'])assert.equal(validateCopy([{heading:copy.frames[0].heading,body:unsafe}],copy.caption,card,c).valid,false);c.profile.facts[0].status='verified';assert.equal(validateCopy([{heading:copy.frames[0].heading,body:'We are open on Sundays.'}],copy.caption,card,c).valid,true)});
test('V4 planning uses clinic and global cooldown history',()=>{const c={id:'c',profile:{services:[],location:'Kochi'}};const first=rankCards(c)[0],history=[{clinic_id:'c',knowledge_card_id:first.card.id,angle_id:first.angle.id,headline:first.angle.hook,region:'Kochi',generated_at:new Date().toISOString(),status:'published'}];assert.notEqual(rankCards(c,history)[0].card.id,first.card.id);const global={...history[0],clinic_id:'other'};assert.ok(rankCards(c,[global]).find(r=>r.angle.id===first.angle.id).score<first.score);assert.equal(weekStart('2026-10-03'),'2026-09-28')});
test('V4 weekly pack prioritizes the hero, preserves parallel frames, then supports approval/export access',async()=>{const f=fixture(),{clinic,week}=await f.setup();assert.equal(week.items.length,6);assert.equal(new Set(week.items.map(i=>i.knowledge_card_id )).size,6);assert.deepEqual(week.items.map(i=>i.type),['carousel','carousel','post','post','story','story']);assert.equal((await f.call(`/clinics/${clinic.id}/weeks`,'POST',{})).week.id,week.id);await f.call(`/weeks/${week.id}/generate`,'POST',{});assert.equal(f.queued.length,6);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v4_jobs WHERE kind='frame' AND priority=1").get().n,0);const first=f.queued.splice(0);await Promise.all(first.map(id=>f.service.consume(id)));const writing=f.queued.splice(0);await Promise.all(writing.map(id=>f.service.consume(id)));let current=(await f.call(`/weeks/${week.id}`)).week;assert.equal(current.heroReady,false);assert.equal(current.items[0].copy_status,'approved');assert.equal(current.items[0].frames.filter(i=>i.assetId).length,0);assert.equal(f.queued.length,14);await f.drain();current=(await f.call(`/weeks/${week.id}`)).week;assert.equal(current.ready,6);assert.equal(current.status,'ready');assert.equal(f.generated(),14);const asset=current.items[0].frames[0].assetId;await assert.rejects(f.call(`/assets/${asset}/original`,'GET',undefined,'B'),/Image not found/);await assert.rejects(f.call(`/weeks/${week.id}`,'GET',undefined,'B'),/Week not found/);await assert.rejects(f.call(`/clinics/${clinic.id}`,'GET',undefined,'B'),/Clinic not found/);const approved=(await f.call(`/weeks/${week.id}/approve`,'POST',{})).week;assert.equal(approved.status,'approved');assert.ok(approved.items.every(i=>i.status==='approved'));f.sqlite.close()});
test('V4 failed frames retry without recreating successful artwork, edits regenerate only changed frames',async()=>{const f=fixture(),{week}=await f.setup();f.failFrame(3);await f.call(`/weeks/${week.id}/generate`,'POST',{});await f.drain();let current=(await f.call(`/weeks/${week.id}`)).week;assert.equal(current.heroReady,false);assert.equal(current.items[0].frames.filter(i=>i.assetId).length,4);await assert.rejects(f.call(`/weeks/${week.id}/approve`,'POST',{}),/artwork must be ready/);const failed=current.jobs.filter(j=>j.status==='failed');f.failFrame(0);for(const j of failed)await f.call(`/jobs/${j.id}/retry`,'POST',{});await f.drain();current=(await f.call(`/weeks/${week.id}`)).week;assert.equal(current.ready,6);const item=current.items[0],previous=item.frames.map(f=>f.assetId),frames=item.frames.map(f=>({heading:f.heading,body:f.body}));frames[1].body=frames[2].body;await f.call(`/content/${item.id}`,'PUT',{revision:item.revision,caption:item.caption,frames});const edited=(await f.call(`/weeks/${week.id}`)).week.items[0];assert.equal(edited.frames[0].assetId,previous[0]);assert.equal(edited.frames[1].assetId,'');await f.drain();const ready=(await f.call(`/weeks/${week.id}`)).week.items[0];assert.notEqual(ready.frames[1].assetId,previous[1]);assert.equal(ready.frames[2].assetId,previous[2]);await assert.rejects(f.call(`/content/${item.id}`,'PUT',{revision:item.revision}),/Content changed/);f.sqlite.close()});
test('V4 activation rejection leaves reviewed content intact; style choices are clinic scoped',async()=>{const f=fixture(),{clinic,week}=await f.setup();await f.call(`/weeks/${week.id}/generate`,'POST',{});await f.drain();const item=(await f.call(`/weeks/${week.id}`)).week.items[0];f.setActive(false);await assert.rejects(f.call(`/content/${item.id}/generate`,'POST',{}),/Awaiting activation/);assert.equal((await f.call(`/weeks/${week.id}`)).week.items[0].revision,item.revision);const other=(await f.call('/clinics','POST',{name:'Other'})).clinic;await assert.rejects(f.call(`/clinics/${other.id}/style-selection`,'PUT',{primaryStyleId:clinic.styleSelection.primaryStyleId}),/Choose a ready style/);await assert.rejects(f.call(`/clinics/${clinic.id}/profile`,'PUT',{revision:1,name:'stale'}),/details changed/);f.sqlite.close()});
test('V4 website imports reject private addresses, redirect escapes, oversized pages and extract candidate facts only',async()=>{for(const url of ['http://clinic.com','https://127.0.0.1','https://[::1]','https://192.168.1.1','https://clinic.local','https://u:p@clinic.com','https://clinic.com:444'])assert.throws(()=>publicUrl(url));await assert.rejects(publicFetch('https://clinic.com',async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}})),/public HTTPS/);await assert.rejects(publicFetch('https://clinic.com',async()=>new Response('x'.repeat(2000001))),/too large/);const html='<title>River Dental | Home</title><meta name="theme-color" content="#112233"><script type="application/ld+json">{"@type":"Dentist","name":"River Dental","address":{"addressLocality":"Kochi"},"telephone":"+91 1234567890"}</script><p>General dentistry, whitening</p>';const extracted=extractCandidates(html,'https://clinic.com');assert.equal(extracted.name,'River Dental');assert.equal(extracted.location,'Kochi');assert.equal(extracted.primary,'#112233');assert.equal(extracted.facts[0].status,'imported')});

test('Standalone formats require copy review, send real references, and preserve selected CTA contacts',async()=>{
 const f=fixture(),{clinic,week}=await f.setup({language:'Malayalam + English',phone:'+91 1234567890',whatsapp:'+91 9876543210',address:'River Road, Kochi',website:'https://river.example.com',bookingUrl:'https://river.example.com/book'});
 assert.equal(week.ready,0);assert.ok(week.items.every(i=>i.frames.length===0));
 for(const type of ['carousel','story','post']){
  const {item}=await f.call(`/clinics/${clinic.id}/content`,'POST',{type,topic:'Clinic update',customBrief:'Our Sunday clinic is open from 10am to 1pm.',styleId:clinic.styleSelection.primaryStyleId,contactKeys:['phone','address','bookingUrl']});
  assert.equal(item.week_id,null);assert.equal(item.language,'Malayalam + English');await f.drain();
  await assert.rejects(f.call(`/content/${item.id}/generate`,'POST',{}),/approve the copy/);
  await f.call(`/content/${item.id}/write`,'POST',{});await f.drain();
  let current=(await f.call(`/content/${item.id}`)).item;
  assert.equal(current.frames.length,type==='carousel'?5:1);assert.equal(current.copy_status,'validated');assert.equal(f.generated(),type==='carousel'?0:type==='story'?5:6);
  assert.deepEqual(current.frames.at(-1).contacts,{phone:'+91 1234567890',address:'River Road, Kochi',bookingUrl:'https://river.example.com/book'});
  assert.ok(current.frames.slice(0,-1).every(frame=>Object.keys(frame.contacts).length===0));
  const writing=f.textCalls.filter(c=>c.schema.properties.frames).at(-1);assert.ok(writing.reference.bytes.length);assert.match(writing.prompt,/Malayalam \+ English/);assert.match(writing.prompt,/selected template reference/);assert.match(writing.prompt,/phone.*1234567890/s);
  await f.call(`/content/${item.id}/approve-copy`,'POST',{});await f.drain();current=(await f.call(`/content/${item.id}`)).item;assert.equal(current.status,'ready');
  await f.call(`/content/${item.id}/approve`,'POST',{});
  // Next format starts with a fresh counter comparison, using actual number of prior images.
  const before=f.generated();assert.equal(before,(type==='carousel'?5:type==='story'?6:7));
 }
 const library=(await f.call(`/clinics/${clinic.id}/library`)).items;assert.equal(library.filter(i=>i.week_id===null).length,3);assert.equal((await f.call(`/weeks/${week.id}`)).week.total,6);
 f.sqlite.close();
});

test('Provider mappings are account scoped and queued writing retains both task choices',async()=>{
 const f=fixture(),{clinic}=await f.setup();const config=await f.call('/providers');config.tasks.validation={provider:'gemini',model:'validator-a'};await f.call('/providers','PUT',{tasks:config.tasks});
 const {item}=await f.call(`/clinics/${clinic.id}/content`,'POST',{type:'post',customBrief:'Our clinic is open on Sunday.'});await f.drain();await f.call(`/content/${item.id}/write`,'POST',{});
 const queued=f.sqlite.prepare("SELECT input_json FROM v4_jobs WHERE content_id=? AND kind='writing'").get(item.id),snapshot=JSON.parse(queued.input_json);
 assert.deepEqual(snapshot.validationGeneration,{provider:'gemini',model:'validator-a'});assert.equal(snapshot.generation.model,'writer-a');
 config.tasks.writing={provider:'openai',model:'writer-b'};await f.call('/providers','PUT',{tasks:config.tasks});await f.drain();
 assert.equal(f.textCalls.filter(c=>c.schema.properties.frames).at(-1).generation.model,'writer-a');assert.equal(f.textCalls.filter(c=>c.schema.properties.valid).at(-1).generation.provider,'gemini');
 assert.equal((await f.call('/providers','GET',undefined,'B')).tasks.writing.model,'writer-a');
 config.tasks.artwork={provider:'gemini',model:'not-a-model'};await assert.rejects(f.call('/providers','PUT',{tasks:config.tasks}),/supported model/);
 f.sqlite.close();
});

test('Validation failures stop weekly artwork, and changed clinic contacts invalidate standalone approval',async()=>{
 const f=fixture(),{clinic,week}=await f.setup({phone:'+91 1234567890'});f.rejectValidation(true);await f.call(`/weeks/${week.id}/generate`,'POST',{});await f.drain();
 const rejected=(await f.call(`/weeks/${week.id}`)).week;assert.equal(f.generated(),0);assert.ok(rejected.items.every(i=>i.copy_status==='rejected'));assert.ok(rejected.items.every(i=>i.validation.issues.length));
 await assert.rejects(f.call(`/content/${rejected.items[0].id}/approve-copy`,'POST',{}),/Validate the draft/);
 f.rejectValidation(false);const {item}=await f.call(`/clinics/${clinic.id}/content`,'POST',{type:'story',customBrief:'Our clinic welcomes new patients.'});await f.drain();await f.call(`/content/${item.id}/write`,'POST',{});await f.drain();
 const latest=(await f.call(`/clinics/${clinic.id}`)).clinic;await f.call(`/clinics/${clinic.id}/profile`,'PUT',{revision:latest.revision,phone:'+91 9999999999',confirmed:true});
 await assert.rejects(f.call(`/content/${item.id}/approve-copy`,'POST',{}),/Clinic details or language changed/);
 f.sqlite.close();
});

test('Selective artwork approves validated weekly copy and retries only missing frames',async()=>{
 const f=fixture(),{week}=await f.setup();
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'writing'});await f.drain();
 const item=(await f.call(`/content/${week.items[0].id}`)).item;
 assert.equal(item.copy_status,'validated');
 f.failFrame(3);await f.call(`/content/${item.id}/generate`,'POST',{});await f.drain();
 const partial=(await f.call(`/content/${item.id}`)).item;
 assert.equal(partial.frames.filter(frame=>frame.assetId).length,4);
 f.failFrame(0);await f.call(`/content/${item.id}/generate`,'POST',{});await f.drain();
 const current=(await f.call(`/weeks/${week.id}`)).week;
 assert.equal(current.items[0].status,'ready');
 assert.ok(current.items.slice(1).every(i=>i.frames.every(frame=>!frame.assetId)));
 for(const frame of partial.frames.filter(frame=>frame.assetId))assert.equal(current.items[0].frames.find(v=>v.position===frame.position).assetId,frame.assetId);
 assert.equal(f.generated(),6);f.sqlite.close();
});

test('Remaining artwork resumes only the selected carousel in a stopped week',async()=>{
 const f=fixture(),{week}=await f.setup();
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'writing'});
 await f.drain();
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'images'});
 await f.call(`/weeks/${week.id}/cancel`,'POST',{});
 await f.drain();
 const item=(await f.call(`/content/${week.items[0].id}`)).item;
 assert.equal(item.copy_status,'approved');
 const resumed=await f.call(`/content/${item.id}/generate`,'POST',{});
 assert.equal(resumed.item.status,'generating');
 assert.equal(resumed.jobs.filter(j=>j.status==='queued').length,5);
 await f.drain();
 const current=(await f.call(`/weeks/${week.id}`)).week;
 assert.equal(current.items[0].status,'ready');
 assert.ok(current.items.slice(1).every(i=>i.frames.every(frame=>!frame.assetId)));
 assert.equal(f.generated(),5);
 f.sqlite.close();
});

test('Custom briefs replace weekly briefs and canceled writing cannot create stale artwork',async()=>{
 const f=fixture(),{clinic,week}=await f.setup();let item=week.items[0];
 await f.call(`/content/${item.id}/brief`,'PUT',{revision:item.revision,customBrief:'Announce our Sunday hours.',topic:'Sunday opening',contactKeys:[]});await f.drain();
 item=(await f.call(`/content/${item.id}`)).item;assert.equal(item.brief.origin,'custom');assert.equal(item.brief.sourceSummary,'Announce our Sunday hours.');assert.equal(item.knowledge_card_id,'');
 await f.call(`/content/${item.id}/write`,'POST',{});const obsolete=f.queued.splice(0);await f.call(`/content/${item.id}/cancel`,'POST',{});await Promise.all(obsolete.map(id=>f.service.consume(id)));assert.equal(f.generated(),0);
 const cancelled=(await f.call(`/content/${item.id}`)).item;await f.call(`/content/${item.id}/brief`,'PUT',{revision:cancelled.revision,customBrief:'Announce our Monday hours.',topic:'Monday opening'});await f.drain();await assert.rejects(f.call(`/jobs/${obsolete[0]}/retry`,'POST',{}),/older draft/);
 await f.call(`/content/${item.id}/write`,'POST',{});await f.drain();assert.equal((await f.call(`/content/${item.id}`)).item.status,'copy_review');await f.call(`/content/${item.id}/approve-copy`,'POST',{});await f.drain();assert.equal((await f.call(`/content/${item.id}`)).item.status,'ready');
 f.sqlite.close();
});

 test('Topic alone automatically prepares a brief and validated content; weekly preparation combines both stages',async()=>{
 const f=fixture(),{clinic,week}=await f.setup();
 await assert.rejects(f.call(`/clinics/${clinic.id}/content`,'POST',{type:'post',topic:'  '}),/topic/);
 const {item}=await f.call(`/clinics/${clinic.id}/content`,'POST',{type:'post',topic:'Welcoming new patients'});
 assert.equal(item.brief.sourceTopic,'Welcoming new patients');assert.equal(item.knowledge_card_id,'');
 await f.drain();const current=(await f.call(`/content/${item.id}`)).item;
 assert.ok(current.brief.prepared);assert.equal(current.frames.length,1);assert.equal(current.copy_status,'validated');assert.equal(f.generated(),0);
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'brief'});await f.drain();
 const prepared=(await f.call(`/weeks/${week.id}`)).week;
 assert.ok(prepared.items.every(i=>i.brief.prepared&&i.frames.length&&i.copy_status==='validated'));assert.equal(f.generated(),0);
 f.sqlite.close();
 });

test('Changing a weekly topic selects a different source without starting generation',async()=>{
 const f=fixture(),{week}=await f.setup();const original=week.items[0],others=week.items.slice(1).map(i=>i.knowledge_card_id);
 for(let n=0;n<3;n++){
  const before=(await f.call(`/content/${original.id}`)).item;
  await f.call(`/content/${original.id}/replace`,'POST',{});
  const next=(await f.call(`/content/${original.id}`)).item;
  assert.notEqual(next.knowledge_card_id,before.knowledge_card_id);assert.ok(!others.includes(next.knowledge_card_id));
  assert.equal(next.type,original.type);assert.equal(next.status,'planned');assert.equal(next.frames.length,0);assert.equal(next.brief.prepared,false);assert.equal(f.queued.length,0);
 }
 assert.equal((await f.call(`/weeks/${week.id}`)).week.items.length,6);
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'brief'});await f.drain();
 const prepared=(await f.call(`/weeks/${week.id}`)).week.items[0];assert.ok(prepared.frames.length);
 await f.call(`/content/${prepared.id}/replace`,'POST',{});const replaced=(await f.call(`/content/${prepared.id}`)).item;
 assert.equal(replaced.frames.length,0);assert.equal(replaced.caption,'');assert.equal(replaced.copy_status,'draft');assert.equal(replaced.status,'planned');
 f.sqlite.close();
});

test('Removing a week cancels queued work, preserves other content, and allows replanning',async()=>{
 const f=fixture(),{clinic,week}=await f.setup();
 const {item}=await f.call(`/clinics/${clinic.id}/content`,'POST',{type:'post',topic:'Welcome'});await f.drain();
 const date=new Date(`${week.week_start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+7);
 const other=(await f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:date.toISOString()})).week;
 await f.call(`/weeks/${week.id}/generate`,'POST',{stage:'brief'});const obsolete=f.queued.splice(0);
 await assert.rejects(f.call(`/weeks/${week.id}`,'DELETE',undefined,'B'),/Week not found/);
 await f.call(`/weeks/${week.id}`,'DELETE');await Promise.all(obsolete.map(id=>f.service.consume(id)));
 await assert.rejects(f.call(`/weeks/${week.id}`),/Week not found/);
 await assert.rejects(f.call(`/content/${week.items[0].id}`),/Content not found/);
 assert.equal((await f.call(`/weeks/${other.id}`)).week.items.length,6);
 assert.equal((await f.call(`/content/${item.id}`)).item.copy_status,'validated');
 const library=(await f.call(`/clinics/${clinic.id}/library`)).items;assert.equal(library.length,7);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v4_jobs WHERE week_id=?').get(week.id).n,0);
 const replanned=(await f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:week.week_start})).week;
 assert.notEqual(replanned.id,week.id);assert.equal(replanned.items.length,6);assert.ok(replanned.items.every(i=>i.status==='planned'));assert.equal(f.generated(),0);
 f.sqlite.close();
});

test('Publication is explicit, persists after deletion, and skipped/replaced plans release topics',async()=>{
 const f=fixture(),{clinic,week}=await f.setup(),item=week.items[0];
 await assert.rejects(f.call(`/content/${item.id}/publish`,'POST',{},'B'),/Content not found/);
 await assert.rejects(f.call(`/content/${item.id}/publish`,'POST',{}),/Finish the artwork/);
 await f.call(`/content/${item.id}/replace`,'POST',{});
 assert.equal(f.sqlite.prepare("SELECT status FROM v4_usage WHERE content_id=? ORDER BY rowid LIMIT 1").get(item.id).status,'rejected');
 await f.call(`/content/${week.items[1].id}/skip`,'POST',{});
 await f.call(`/weeks/${week.id}/generate`,'POST',{});await f.drain();
 const ready=(await f.call(`/content/${item.id}`)).item;assert.equal(ready.published,false);
 await f.call(`/content/${item.id}/publish`,'POST',{});await f.call(`/content/${item.id}/publish`,'POST',{});
 assert.equal((await f.call(`/content/${item.id}`)).item.published,true);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v4_usage WHERE content_id=? AND status='published'").get(item.id).n,1);
 await f.call(`/content/${item.id}/replace`,'POST',{});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v4_usage WHERE content_id=? AND status='published'").get(item.id).n,1);
 await f.call(`/weeks/${week.id}`,'DELETE');
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v4_usage WHERE content_id=? AND status='published'").get(item.id).n,1);
 f.sqlite.close();
});


test('weekly planning reuses shared history, styles and provider checks',async()=>{
 const f=fixture();try{const {clinic}=await f.setup();f.queryLog.length=0;
 const {week}=await f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:'2030-01-07'});
 assert.equal(week.items.length,6);assert.equal(new Set(week.items.map(i=>i.knowledge_card_id )).size,6);
 assert.equal(f.queryLog.filter(q=>q.startsWith('SELECT u.* FROM v4_usage')).length,1);
 assert.equal(f.queryLog.filter(q=>q.startsWith('SELECT tasks_json FROM v4_provider_settings')).length,1);
 assert.ok(f.queryLog.length<=25,`Expected at most 25 queries, got ${f.queryLog.length}`);
 }finally{f.sqlite.close();}
});

test('weekly plan and content are persisted atomically in one batch',async()=>{
 const f=fixture();try{const {clinic}=await f.setup();f.batchCalls.length=0;
 const {week}=await f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:'2030-02-04'});
 assert.deepEqual(f.batchCalls,[13,3]);assert.equal(week.items.length,6);
 const latest=await f.call(`/clinics/${clinic.id}/weeks?latest=1`);assert.equal(latest.week.id,week.id);
 const empty=(await f.call('/clinics','POST',{name:'Empty clinic'})).clinic;
 assert.equal((await f.call(`/clinics/${empty.id}/weeks?latest=1`)).week,null);
 await assert.rejects(f.call(`/clinics/${clinic.id}/weeks?latest=1`,'GET',undefined,'B'),/Clinic not found/);
 }finally{f.sqlite.close();}
});
test('competing requests for the same week produce only one complete plan',async()=>{
 const f=fixture();try{const {clinic}=await f.setup();const plans=await Promise.all([1,2].map(()=>f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:'2030-03-04'})));
 assert.equal(plans[0].week.id,plans[1].week.id);assert.equal(plans[0].week.items.length,6);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v4_content WHERE week_id=?').get(plans[0].week.id).n,6);
 }finally{f.sqlite.close();}
});
test('a failed planning batch leaves no empty week or partial content',async()=>{
 const f=fixture();try{const {clinic}=await f.setup();const before=f.sqlite.prepare('SELECT COUNT(*) n FROM v4_content').get().n;
 f.sqlite.exec("CREATE TRIGGER break_plan BEFORE INSERT ON v4_usage BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
 await assert.rejects(f.call(`/clinics/${clinic.id}/weeks`,'POST',{weekStart:'2030-04-01'}),/simulated failure/);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v4_weeks WHERE week_start='2030-04-01'").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v4_content').get().n,before);
 }finally{f.sqlite.close();}
});

test('library bundles weeks and items while review batches content and jobs',async()=>{
 const f=fixture();try{const {clinic,week}=await f.setup();f.batchCalls.length=0;
 const library=await f.call(`/clinics/${clinic.id}/library?weeks=1`);
 assert.equal(library.items.length,6);assert.equal(library.weeks[0].id,week.id);assert.deepEqual(f.batchCalls,[2]);
 f.batchCalls.length=0;const review=await f.call(`/content/${week.items[0].id}`);
 assert.equal(review.item.id,week.items[0].id);assert.deepEqual(f.batchCalls,[2]);
 assert.equal(review.item.published,false);
 }finally{f.sqlite.close();}
});
test('V4 styles regenerate in place with change notes and removed styles can return',async()=>{const f=fixture(),{clinic}=await f.setup();let {styles}=await f.call(`/clinics/${clinic.id}`);const target=styles[0],before=target.asset_id;
 await f.call(`/clinics/${clinic.id}/styles/${target.id}/regenerate`,'POST',{notes:'Darker background, bigger headings'});
 assert.equal((await f.call(`/clinics/${clinic.id}`)).styles.find(s=>s.id===target.id).status,'generating');
 await assert.rejects(f.call(`/clinics/${clinic.id}/styles/${target.id}/regenerate`,'POST',{}),/already being created/);
 await f.drain();const [,reference,,,,options]=f.styleCalls.at(-1);assert.equal(reference,target.reference_id);assert.deepEqual(options,{notes:'Darker background, bigger headings',currentAssetId:before});
 const after=(await f.call(`/clinics/${clinic.id}`)).styles.find(s=>s.id===target.id);assert.equal(after.status,'ready');assert.notEqual(after.asset_id,before);
 const removed=styles[2];await f.call(`/clinics/${clinic.id}/styles/${removed.id}`,'DELETE',{});
 for(let i=0;i<4;i++){await f.call(`/clinics/${clinic.id}/styles`,'POST',{});await f.drain();}
 const revived=(await f.call(`/clinics/${clinic.id}`)).styles.find(s=>s.id===removed.id);assert.equal(revived?.status,'ready');f.sqlite.close()});
test('V4 a cancelled style regeneration keeps the previous artwork usable',async()=>{const f=fixture(),{clinic}=await f.setup();const target=(await f.call(`/clinics/${clinic.id}`)).styles[0];
 f.sqlite.prepare("UPDATE v4_styles SET status='generating' WHERE id=?").run(target.id);const job=f.sqlite.prepare("SELECT id FROM v4_jobs WHERE kind='style' AND json_extract(input_json,'$.styleId')=?").get(target.id);
 await f.call(`/clinics/${clinic.id}/styles/cancel`,'POST',{});f.sqlite.prepare("UPDATE v4_jobs SET status='queued' WHERE id=?").run(job.id);f.sqlite.prepare("UPDATE v4_styles SET status='generating' WHERE id=?").run(target.id);
 await f.call(`/clinics/${clinic.id}/styles/cancel`,'POST',{});const after=(await f.call(`/clinics/${clinic.id}`)).styles.find(s=>s.id===target.id);assert.equal(after.status,'ready');assert.equal(after.asset_id,target.asset_id);f.sqlite.close()});
