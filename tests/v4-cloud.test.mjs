import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {cloudV4} from '../cloudflare/v4.mjs';
import {mockContent} from './v4-fixtures.mjs';
const schema=await readFile(new URL('../cloudflare/migrations/0001_accounts_credits.sql',import.meta.url),'utf8')+await readFile(new URL('../cloudflare/migrations/0009_srshti_v4.sql',import.meta.url),'utf8')+await readFile(new URL('../cloudflare/migrations/0010_v4_manual_clinic_plan.sql',import.meta.url),'utf8')+await readFile(new URL('../cloudflare/migrations/0011_v4_content_pipeline.sql',import.meta.url),'utf8');
const png=await sharp({create:{width:240,height:180,channels:4,background:'#6960dc'}}).png().toBuffer();
function fixture(){const sqlite=new Database(':memory:');sqlite.exec(schema);sqlite.prepare("INSERT INTO accounts(id,name) VALUES('A','River Dental')").run();const queued=[],objects=new Map();const DB={prepare(sql){return {bind(...values){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...values)||null,run:async()=>({meta:stmt.run(...values)}),all:async()=>({results:stmt.all(...values)})}}}}};const IMAGES={async info(stream){const buffer=Buffer.from(await new Response(stream).arrayBuffer());return sharp(buffer).metadata()},input(stream){let transform={};return {transform(value){transform=value;return this},async output({format,quality}){let instance=sharp(Buffer.from(await new Response(stream).arrayBuffer()));if(transform.width)instance=instance.resize({width:transform.width,height:transform.height,fit:transform.fit==='pad'?'contain':undefined,background:transform.background||'#fff',withoutEnlargement:!transform.height});const bytes=await (format==='image/webp'?instance.webp({quality}):instance.png()).toBuffer();return {response:()=>new Response(bytes,{headers:{'Content-Type':format}})}}}}};const env={DB,IMAGES,APP_ORIGIN:'https://studio.test',OPENAI_API_KEY:'test-only',GENERATION:{send:async body=>queued.push(body.v4JobId)},STATIC:{fetch:async()=>new Response(png)},ASSETS:{put:async(key,bytes,meta)=>objects.set(key,{bytes:Buffer.from(bytes),...meta}),get:async key=>{const value=objects.get(key);return value&&{arrayBuffer:async()=>value.bytes,httpMetadata:value.httpMetadata}}}};const service=cloudV4(env);
 const call=async(path,method='GET',body)=>{const url=new URL('https://studio.test/api/v4'+path);return (await service.route(new Request(url,{method,body:body===undefined?undefined:JSON.stringify(body)}),'A',url)).json()};
 const activate=()=>{sqlite.prepare("INSERT INTO subscriptions(account_id,plan_id,plan_version,status) VALUES('A','founding-clinic',1,'manual')").run();sqlite.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('allocation','A',900,'manual_plan','manual:2026-10')").run()};
 return {sqlite,queued,objects,env,service,call,activate};}
test('Cloud V4 manual activation gates paid work and refunds provider failures; media variants remain private',async t=>{const f=fixture();const c=(await f.call('/clinics','POST',{name:'River Dental'})).clinic;await assert.rejects(f.call(`/clinics/${c.id}/styles`,'POST',{}),/awaiting activation/);assert.equal(f.queued.length,0);f.activate();let requests=0;t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/images/edits');assert.ok(options.body instanceof FormData);assert.equal(options.body.get('model'),'gpt-image-1');if(++requests===1)return new Response('{}',{status:503});return Response.json({data:[{b64_json:png.toString('base64')}]})});await f.call(`/clinics/${c.id}/styles`,'POST',{});await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));let data=await f.call(`/clinics/${c.id}`);assert.equal(data.styles.filter(s=>s.status==='ready').length,2);assert.equal(f.sqlite.prepare("SELECT SUM(amount) n FROM credit_ledger WHERE account_id='A'").get().n,880);const failed=data.jobs.find(j=>j.status==='failed');await f.call(`/jobs/${failed.id}/retry`,'POST',{});await f.service.consume(f.queued.shift());data=await f.call(`/clinics/${c.id}`);assert.equal(data.styles.filter(s=>s.status==='ready').length,3);assert.equal(f.sqlite.prepare("SELECT SUM(amount) n FROM credit_ledger WHERE account_id='A'").get().n,870);const asset=f.sqlite.prepare('SELECT * FROM v4_assets LIMIT 1').get();assert.ok(asset.original_key.startsWith(`A/v4/${c.id}/`));assert.equal(asset.width,240);assert.equal(asset.height,180);const response=await f.service.route(new Request(`https://studio.test/api/v4/assets/${asset.id}/thumbnail`),'A',new URL(`https://studio.test/api/v4/assets/${asset.id}/thumbnail`));assert.equal(response.headers.get('Content-Type'),'image/webp');assert.match(response.headers.get('Cache-Control'),/private/);assert.equal(response.headers.get('Vary'),'Cookie');assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,'webp');f.sqlite.close()});
test('Cloud V4 generates native content canvases and preserves provider artwork without resizing',async t=>{
 const f=fixture();f.activate();f.env.SRSHTI_IMAGE_MODEL='gpt-image-2';
 const generated=new Map();
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('chat/completions')){
   const request=JSON.parse(options.body);
   return Response.json({choices:[{message:{content:JSON.stringify(mockContent(request.messages[0].content[0].text,request.response_format.json_schema.schema))}}]});
  }
  const form=options.body,size=form.get('size'),[width,height]=size.split('x').map(Number);
  assert.equal(form.get('model'),'gpt-image-2');assert.ok(form.getAll('image[]').length>0);
  const bytes=await sharp({create:{width,height,channels:4,background:'#00505a'}}).png().toBuffer();
  generated.set(size,bytes);return Response.json({data:[{b64_json:bytes.toString('base64')}]});
 });
 try{
  const c=(await f.call('/clinics','POST',{name:'River Dental'})).clinic;
  await f.call(`/clinics/${c.id}/profile`,'PUT',{revision:c.revision,confirmed:true});
  await f.call(`/clinics/${c.id}/styles`,'POST',{});await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));
  const {styles}=await f.call(`/clinics/${c.id}`);await f.call(`/clinics/${c.id}/style-selection`,'PUT',{primaryStyleId:styles[0].id});
  const {week}=await f.call(`/clinics/${c.id}/weeks`,'POST',{});
  await f.call(`/weeks/${week.id}/generate`,'POST',{});
  while(f.queued.length)await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));
  const current=(await f.call(`/weeks/${week.id}`)).week;
  assert.equal(current.heroReady,true);assert.equal(current.ready,current.items.length);
  for(const item of current.items){
   const size=item.type==='story'?'864x1536':item.type==='post'?'1024x1024':'1024x1280';
   for(const frame of item.frames){
    const asset=f.sqlite.prepare('SELECT * FROM v4_assets WHERE id=?').get(frame.assetId);
    const bytes=f.objects.get(asset.original_key).bytes,meta=await sharp(bytes).metadata();
    assert.equal(`${meta.width}x${meta.height}`,size);assert.deepEqual(bytes,generated.get(size));
   }
  }
  assert.equal(f.sqlite.prepare("SELECT SUM(amount) n FROM credit_ledger WHERE account_id='A'").get().n,706);
 }finally{f.sqlite.close();}
});

test('Cloud V4 rejects wrong-ratio generated artwork and refunds its credits',async t=>{
 const f=fixture();f.activate();f.env.SRSHTI_IMAGE_MODEL='gpt-image-2';
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('chat/completions')){
   const request=JSON.parse(options.body);return Response.json({choices:[{message:{content:JSON.stringify(mockContent(request.messages[0].content[0].text,request.response_format.json_schema.schema))}}]});
  }
  return Response.json({data:[{b64_json:png.toString('base64')}]});
 });
 try{
  const c=(await f.call('/clinics','POST',{name:'River Dental'})).clinic;
  await f.call(`/clinics/${c.id}/profile`,'PUT',{revision:c.revision,confirmed:true});
  await f.call(`/clinics/${c.id}/styles`,'POST',{});await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));
  const {styles}=await f.call(`/clinics/${c.id}`);await f.call(`/clinics/${c.id}/style-selection`,'PUT',{primaryStyleId:styles[0].id});
  const item=(await f.call(`/clinics/${c.id}/content`,'POST',{type:'carousel',topic:'Daily care'})).item;
  while(f.queued.length)await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));
  await f.call(`/content/${item.id}/approve-copy`,'POST',{});
  const balance=f.sqlite.prepare("SELECT SUM(amount) n FROM credit_ledger WHERE account_id='A'").get().n;
  while(f.queued.length)await Promise.all(f.queued.splice(0).map(id=>f.service.consume(id)));
  const data=await f.call(`/content/${item.id}`);
  assert.ok(data.item.frames.every(frame=>!frame.assetId));
  const failures=data.jobs.filter(job=>job.kind==='frame');assert.equal(failures.length,5);
  assert.ok(failures.every(job=>job.status==='failed'&&/requires 4:5/.test(job.error)));
  assert.equal(f.sqlite.prepare("SELECT SUM(amount) n FROM credit_ledger WHERE account_id='A'").get().n,balance);
 }finally{f.sqlite.close();}
});

test('only admin can manage shared models; client jobs ignore old account model choices',async()=>{
 const f=fixture(),admin=cloudV4(f.env,{isAdmin:true});f.activate();
 const request=async(service,path,method='GET',body)=>{const url=new URL('https://studio.test/api/v4'+path);return (await service.route(new Request(url,{method,body:body?JSON.stringify(body):undefined}),'A',url)).json();};
 try{
  await assert.rejects(request(f.service,'/providers'),{status:403});
  await assert.rejects(request(f.service,'/providers','PUT',{tasks:{}}),{status:403});
  const {tasks}=await request(admin,'/providers');
  tasks.style={provider:'openai',model:'gpt-image-2.5-flare',quality:'high'};
  tasks.artwork={provider:'openai',model:'gpt-image-2.5-flare',quality:'high'};
  await request(admin,'/providers','PUT',{tasks});
  f.sqlite.prepare('INSERT INTO v4_provider_settings(account_id,tasks_json,updated_at) VALUES(?,?,?)').run('A',JSON.stringify({...tasks,style:{provider:'openai',model:'gpt-image-1',quality:'low'}}),new Date().toISOString());
  const c=(await f.call('/clinics','POST',{name:'Client Clinic'})).clinic;
  await f.call(`/clinics/${c.id}/styles`,'POST',{});
  const snapshots=f.sqlite.prepare("SELECT input_json FROM v4_jobs WHERE kind='style'").all().map(r=>JSON.parse(r.input_json).generation);
  assert.equal(snapshots.length,3);assert.ok(snapshots.every(s=>s.model==='gpt-image-2.5-flare'&&s.quality==='high'));
  tasks.style.quality='low';await request(admin,'/providers','PUT',{tasks});
  assert.equal(JSON.parse(f.sqlite.prepare("SELECT input_json FROM v4_jobs WHERE kind='style' LIMIT 1").get().input_json).generation.quality,'high');
  assert.equal((await request(admin,'/providers')).tasks.style.quality,'low');
 }finally{f.sqlite.close();}
});

test('cloud worker blocks client advanced studio and companion APIs',async()=>{
 const {default:worker}=await import('../cloudflare/worker.mjs');
 const config=JSON.parse(await readFile(new URL('../wrangler.json',import.meta.url),'utf8'));
 assert.ok(config.assets.run_worker_first.includes('/legacy.html'));
 const env={ADMIN_EMAIL:'admin@example.com',DB:{prepare(){return {bind(){return {first:async()=>({email:'client@example.com',account_id:'client',csrf:'csrf'})};}};}}};
 for(const path of ['/legacy.html','/api/status','/api/render-slide','/api/companion/devices','/api/v4/providers','/api/admin/accounts']){
  const response=await worker.fetch(new Request('https://studio.test'+path,{headers:{Cookie:'cs_session=test'}}),env);
  assert.equal(response.status,403,path);
 }
});


test('administrator retains Advanced Studio access',async()=>{
 const {default:worker}=await import('../cloudflare/worker.mjs');
 const env={ADMIN_EMAIL:'admin@example.com',DB:{prepare(){return {bind(){return {first:async()=>({email:'ADMIN@example.com',account_id:'admin',csrf:'csrf'})};}};}},STATIC:{fetch:async()=>new Response('advanced studio')}};
 const response=await worker.fetch(new Request('https://studio.test/legacy.html',{headers:{Cookie:'cs_session=test'}}),env);
 assert.equal(response.status,200);assert.equal(await response.text(),'advanced studio');
});

test('performance migration creates indexes without changing existing content',async()=>{
 const f=fixture();try{const {clinic}=await f.call('/clinics','POST',{name:'Existing clinic'});f.sqlite.exec(await readFile(new URL('../cloudflare/migrations/0012_v5_performance.sql',import.meta.url),'utf8'));
 assert.equal(f.sqlite.prepare('SELECT name FROM v4_clinics WHERE id=?').get(clinic.id).name,'Existing clinic');
 assert.ok(f.sqlite.prepare("PRAGMA index_list('v4_jobs')").all().some(i=>i.name==='v4_jobs_account_content'));
 }finally{f.sqlite.close();}
});


test('the public homepage does not query session storage',async()=>{
 const {default:worker}=await import('../cloudflare/worker.mjs');let reads=0;
 const response=await worker.fetch(new Request('https://studio.test/',{headers:{Cookie:'cs_session=test'}}),{DB:{prepare(){reads++;throw Error('Unexpected session query')}},STATIC:{fetch:async()=>new Response('app shell')}});
 assert.equal(response.status,200);assert.equal(await response.text(),'app shell');assert.equal(reads,0);
});

test('bootstrap bundles identity and selected clinic without exposing another account',async()=>{
 const f=fixture();try{const c=(await f.call('/clinics','POST',{name:'River Dental'})).clinic;
 const viewer={user_id:'user-a',email:'owner@example.com',account_id:'A',role:'owner',csrf:'test-csrf'},service=cloudV4(f.env,{viewer});
 const url=new URL(`https://studio.test/api/v4/bootstrap?include=clinic&clinic=${c.id}`);
 const data=await (await service.route(new Request(url),'A',url)).json();
 assert.equal(data.me.user.email,viewer.email);assert.equal(data.me.csrf,viewer.csrf);
 assert.equal(data.workspace.clinic.id,c.id);assert.deepEqual(data.workspace.styles,[]);assert.deepEqual(data.workspace.jobs,[]);
 const other=await (await service.route(new Request(url),'B',url)).json();assert.equal(other.clinics.length,0);assert.equal(other.workspace,undefined);
 }finally{f.sqlite.close();}
});
