import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {createLocalProviders} from '../server/v4/providers.mjs';
import {cloudV4} from '../cloudflare/v4.mjs';

test('Local provider choices persist, validate readiness and preserve queued snapshots',async()=>{
 const storageRoot=await mkdtemp(join(tmpdir(),'srshti-providers-'));
 try{
  let loggedIn=false;const env={};const inspect=name=>({installed:true,authenticated:name==='codex'?loggedIn:true,binary:name,version:'mock-cli'});
  let releaseModels;const modelsReady=new Promise(resolve=>{releaseModels=resolve});
  const listAgyModels=async()=>{await modelsReady;return [['gemini-3.8-flash-high','Gemini 3.8 Flash (High)'],['claude-sonnet-4-6','Claude Sonnet 4.6']];};
  let p=createLocalProviders({storageRoot,env,inspect,listAgyModels,listCodexModels:()=>null});assert.equal(p.selected().provider,'antigravity');
  assert.equal(p.selected().model,'gemini-3.8-flash-high');
  let status=await p.status();assert.equal(status.providers.antigravity.modelsLoaded,false);
  assert.deepEqual(status.providers.codex.models.map(([id])=>id),['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','imagegen']);
  await assert.rejects(p.save({provider:'codex',model:'imagegen'}),/codex login/);
  loggedIn=true;await p.save({provider:'codex',model:'gpt-5.6-luna'});const queued=p.selected();
  releaseModels();status=await p.status({refresh:true});assert.equal(status.providers.antigravity.modelsLoaded,true);
  assert.deepEqual(status.providers.antigravity.models.map(([id])=>id),['gemini-3.8-flash-high','claude-sonnet-4-6']);
  await assert.rejects(p.save({provider:'antigravity',model:'not-an-agy-model'}),/supported image model/);
  await p.save({provider:'antigravity',model:'claude-sonnet-4-6'});assert.equal(queued.provider,'codex');assert.equal(queued.model,'gpt-5.6-luna');
  p=createLocalProviders({storageRoot,env,inspect,listAgyModels,listCodexModels:()=>null});assert.deepEqual(p.selected(),{provider:'antigravity',model:'claude-sonnet-4-6'});
  await writeFile(join(storageRoot,'local-generation.json'),JSON.stringify({provider:'antigravity',model:'gemini-3.1-flash-image'}));
  p=createLocalProviders({storageRoot,env,inspect,listAgyModels,listCodexModels:()=>null});assert.equal(p.selected().model,'gemini-3.8-flash-high');
  await assert.rejects(p.save({provider:'unknown',model:'x'}),/supported/);
  await assert.rejects(p.save({provider:'codex',model:'unknown'}),/supported image model/);
  assert.equal(JSON.parse(await readFile(join(storageRoot,'local-generation.json'),'utf8')).provider,'antigravity');
 }finally{await rm(storageRoot,{recursive:true,force:true})}
});

test('Cloud V4 does not expose local provider settings',async()=>{
 const service=cloudV4({});const url=new URL('https://studio.test/api/v4/local-providers');
 for(const method of ['GET','PUT'])await assert.rejects(service.route(new Request(url,{method}),'A',url),error=>error.status===404);
});

for(const provider of ['codex','antigravity'])test(`Local V4 ${provider} adapter creates styles and a complete weekly pack`,async t=>{
 const storageRoot=await mkdtemp(join(tmpdir(),`srshti-${provider}-`));let child;
 try{
  const fixture=join(storageRoot,'fixture.png'),binary=join(storageRoot,'mock-cli');
  await writeFile(fixture,await sharp(randomBytes(180*240*3),{raw:{width:240,height:180,channels:3}}).png().toBuffer());
  await writeFile(binary,`#!${process.execPath}\nimport {mockContent} from ${JSON.stringify(new URL('./v4-fixtures.mjs',import.meta.url).pathname)};\nimport {copyFileSync,appendFileSync,readFileSync,writeFileSync} from 'node:fs';\nconst a=process.argv.slice(2);if(a.includes('--version'))console.log('mock-cli 1.0');else if(a[0]==='login')console.log('Logged in');else if(a[0]==='models')console.log('gemini-3.8-flash-high\\tGemini 3.8 Flash (High)');else{appendFileSync(process.env.TEST_ARGS,JSON.stringify(a)+'\\n');if(a.includes('--output-schema')||a.includes('--json-schema')){const codex=a.includes('--output-schema');const schema=codex?JSON.parse(readFileSync(a[a.indexOf('--output-schema')+1],'utf8')):JSON.parse(a[a.indexOf('--json-schema')+1]);let prompt=codex?'':a[a.indexOf('-p')+1];if(codex)for await(const chunk of process.stdin)prompt+=chunk;const result=mockContent(prompt,schema);if(codex)writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify(result));console.log(JSON.stringify({status:'SUCCESS',structured_output:result}));}else{copyFileSync(process.env.TEST_IMAGE,'final-slide.png');console.log(JSON.stringify({status:'SUCCESS',denied_actions:[]}));}}\n`,{mode:0o755});
  // Use .mjs so the mock executable is independent of the temporary directory's package type.
  const executable=binary+'.mjs';await writeFile(executable,await readFile(binary),{mode:0o755});
  const port=23000+Math.floor(Math.random()*15000);let logs='';
  child=spawn(process.execPath,['scripts/local-start.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',STORAGE_ROOT:storageRoot,CODEX_BIN:executable,AGY_BIN:executable,TEST_IMAGE:fixture,SRSHTI_LOCAL_PROVIDER:provider,SRSHTI_LOCAL_IMAGE_MODEL:provider==='codex'?'gpt-5.6-terra':'gemini-3.8-flash-high',TEST_ARGS:join(storageRoot,'cli-args.jsonl'),OPENAI_API_KEY:'',GEMINI_API_KEY:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const call=async(path,method='GET',body)=>{const res=await fetch(`http://127.0.0.1:${port}/api/v4${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await res.json();assert.equal(res.ok,true,JSON.stringify(value));return value};
  async function waitFor(fn){const until=Date.now()+30000;while(Date.now()<until){if(child.exitCode!==null)throw Error(logs);try{const value=await fn();if(value)return value}catch(e){if(!/fetch failed/.test(e.message))throw e}await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+logs)}
  const boot=await waitFor(()=>call('/bootstrap'));assert.equal(boot.capabilities.local,true);assert.equal(boot.capabilities.generation,true);assert.equal(boot.activation.mode,'local');
  assert.equal((await call('/local-providers')).selection.provider,provider);
  const c=(await call('/clinics','POST',{name:'Pitch Clinic'})).clinic;
  await call(`/clinics/${c.id}/profile`,'PUT',{revision:c.revision,confirmed:true});
  await call(`/clinics/${c.id}/styles`,'POST',{});
  const data=await waitFor(async()=>{const d=await call(`/clinics/${c.id}`);if(d.jobs.some(j=>j.status==='failed'))throw Error(JSON.stringify(d.jobs));return d.styles.filter(s=>s.status==='ready').length===3&&d});
  await call(`/clinics/${c.id}/style-selection`,'PUT',{primaryStyleId:data.styles[0].id});
  const {week}=await call(`/clinics/${c.id}/weeks`,'POST',{});await waitFor(async()=>{const {week:w}=await call(`/weeks/${week.id}`);if(w.jobs.some(j=>j.status==='failed'))throw Error(JSON.stringify(w.jobs));return w.items.every(i=>i.status==='planned');});await call(`/weeks/${week.id}/generate`,'POST',{});
  const ready=await waitFor(async()=>{const {week:w}=await call(`/weeks/${week.id}`);if(w.jobs.some(j=>j.status==='failed'))throw Error(JSON.stringify(w.jobs));return w.ready===6&&w});
  assert.equal(ready.items.reduce((n,i)=>n+i.frames.length,0),14);
  for(const item of ready.items){const res=await fetch(`http://127.0.0.1:${port}/api/v4/assets/${item.frames[0].assetId}/original`);const metadata=await sharp(Buffer.from(await res.arrayBuffer())).metadata();assert.equal(metadata.width,1080);assert.equal(metadata.height,item.type==='story'?1920:item.type==='post'?1080:1350)}
  assert.equal((await call(`/weeks/${week.id}/approve`,'POST',{})).week.status,'approved');
  const runs=(await readFile(join(storageRoot,'cli-args.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const expected=provider==='codex'?'gpt-5.6-terra':'gemini-3.8-flash-high';
  assert.ok(runs.length>=18&&runs.every(args=>args[args.indexOf('--model')+1]===expected),JSON.stringify(runs[0]));
  if(provider==='antigravity')assert.deepEqual((await call('/local-providers?refresh=1')).providers.antigravity.models,[['gemini-3.8-flash-high','Gemini 3.8 Flash (High)']]);
 }finally{if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}await rm(storageRoot,{recursive:true,force:true})}
});
