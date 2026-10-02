import test from 'node:test';
import assert from 'node:assert/strict';
import {imageOptions,normalizeImageOptions} from '../web/image-options.js';
import {generateSlideImage,generateReferenceImage} from '../server/image-providers.mjs';
test('image controls only offer supported model settings',()=>{
 assert.deepEqual(imageOptions('openai','gpt-image-2.5-flare').values,['low','medium','high','xhigh','max','auto']);
 assert.throws(()=>normalizeImageOptions({provider:'openai',model:'gpt-image-2',quality:'max'}),/Unsupported/);
 assert.deepEqual(imageOptions('gemini','gemini-3.1-flash-image').values,['512','1K','2K','4K']);
 assert.deepEqual(imageOptions('gemini','gemini-3-pro-image').values,['1K','2K','4K']);
 assert.deepEqual(imageOptions('gemini','gemini-3.1-flash-lite-image').values,['1K']);
 assert.throws(()=>normalizeImageOptions({provider:'gemini',model:'gemini-2.5-flash-image',imageSize:'4K'}),/Unsupported/);
});
test('artwork and style requests send selected API quality and resolution',async()=>{
 const originalFetch=globalThis.fetch,keys={OPENAI_API_KEY:process.env.OPENAI_API_KEY,GEMINI_API_KEY:process.env.GEMINI_API_KEY};
 process.env.OPENAI_API_KEY='test';process.env.GEMINI_API_KEY='test';
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,body:options.body});return new Response(JSON.stringify(url.includes('openai')?{data:[{b64_json:'aGVsbG8='}]}:{outputs:[{type:'image',data:'aGVsbG8='}]}),{status:200});};
 const image='data:image/png;base64,aGVsbG8=';
 try{
  await generateSlideImage({provider:'openai',model:'gpt-image-2.5-flare',quality:'max',referenceImage:image,slide:{approved:true},prompt:'Test'});
  assert.equal(requests.at(-1).body.get('quality'),'max');
  await generateReferenceImage({provider:'openai',model:'gpt-image-2.5-sunburst',quality:'xhigh',referenceImages:[image],prompt:'Test'});
  assert.equal(requests.at(-1).body.get('quality'),'xhigh');
  await generateSlideImage({provider:'gemini',model:'gemini-3.1-flash-image',imageSize:'512',referenceImage:image,slide:{approved:true},prompt:'Test'});
  assert.equal(JSON.parse(requests.at(-1).body).response_format.image_size,'512');
  await generateReferenceImage({provider:'gemini',model:'gemini-3-pro-image',imageSize:'4K',referenceImages:[image],prompt:'Test'});
  assert.equal(JSON.parse(requests.at(-1).body).response_format.image_size,'4K');
 }finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(keys))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('saved image settings persist and queued style jobs retain their settings',async()=>{
 const {default:Database}=await import('better-sqlite3');
 const {readFile}=await import('node:fs/promises');
 const {createV4Service}=await import('../server/v4/service.mjs');
 const {IMAGE_MODELS,WRITING_MODELS}=await import('../web/provider-models.js');
 const sqlite=new Database(':memory:');
 sqlite.exec(await readFile(new URL('../cloudflare/migrations/0009_srshti_v4.sql',import.meta.url),'utf8'));
 sqlite.exec(await readFile(new URL('../cloudflare/migrations/0011_v4_content_pipeline.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args)||null,all:async()=>({results:stmt.all(...args)}),run:async()=>({meta:stmt.run(...args)})};}};}};
 const service=createV4Service({db,providerCatalog:async()=>Object.fromEntries(['openai','gemini'].map(provider=>[provider,{available:true,models:IMAGE_MODELS[provider],writingModels:WRITING_MODELS[provider]}])),enqueue:async()=>{},requireActivation:async()=>{}});
 const call=async(path,method='GET',input)=>{const url=new URL('https://test/api/v4'+path);return (await service.route(new Request(url,{method,body:input?JSON.stringify(input):undefined}), 'account',url)).json();};
 try{
  const {tasks}=await call('/providers');
  tasks.style={provider:'openai',model:'gpt-image-2.5-flare',quality:'max'};
  tasks.artwork={provider:'gemini',model:'gemini-3.1-flash-image',imageSize:'4K'};
  await call('/providers','PUT',{tasks});
  assert.deepEqual((await call('/providers')).tasks.artwork,tasks.artwork);
  const {clinic}=await call('/clinics','POST',{name:'Test Clinic'});
  await call(`/clinics/${clinic.id}/styles`,'POST',{});
  tasks.style.quality='low';await call('/providers','PUT',{tasks});
  const jobs=sqlite.prepare("SELECT input_json FROM v4_jobs WHERE kind='style'").all();
  assert.equal(jobs.length,3);
  assert.ok(jobs.every(job=>JSON.parse(job.input_json).generation.quality==='max'));
  tasks.style={provider:'openai',model:'gpt-image-2',quality:'max'};
  await assert.rejects(call('/providers','PUT',{tasks}),/Unsupported/);
 }finally{sqlite.close();}
});
