import {artworkPrompt} from './content-prompts.mjs';
import {localStructured} from './text-local.mjs';
import {STYLE_REFERENCES,stylePrompt} from './image-prompts.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {db,storageRoot} from '../store.mjs';
import {createV4Service} from './service.mjs';
import {generateReferenceImage,generateSlideImage,withImageCancellation} from '../image-providers.mjs';
import {withProviderSlot} from '../provider-concurrency.mjs';
import {createLocalProviders} from './providers.mjs';
import {nodePublicFetch} from './public-fetch.mjs';
const root=resolve('web'),dir=join(storageRoot,'v4-assets');await mkdir(dir,{recursive:true});
db.exec(await readFile(new URL('../../cloudflare/migrations/0009_srshti_v4.sql',import.meta.url),'utf8'));
if(!db.prepare('PRAGMA table_info(v4_content)').all().some(c=>c.name==='brief_json'))db.exec(await readFile(new URL('../../cloudflare/migrations/0011_v4_content_pipeline.sql',import.meta.url),'utf8'));
db.exec(await readFile(new URL('../../cloudflare/migrations/0014_sample_requests.sql',import.meta.url),'utf8'));
const DB={prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)}),run:async()=>({meta:s.run(...args)}),execute:()=>s.reader?{results:s.all(...args)}:{results:[],meta:s.run(...args)}}}}}};
DB.batch=async statements=>db.transaction(()=>statements.map(statement=>statement.execute()))();
const providers=createLocalProviders({storageRoot});
// The local agy model directs native image generation; older saved choices named the image model itself.
const agyModel=(provider,model)=>provider==='antigravity'&&!/-image$/.test(model)?model:'';
const parseData=value=>{const m=/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(value);if(!m)throw Error('Provider returned no image.');return {bytes:Buffer.from(m[2],'base64'),mime:m[1]};};
const asData=async assetId=>{if(!assetId)return '';const asset=db.prepare('SELECT * FROM v4_assets WHERE id=?').get(assetId);return asset?`data:${asset.mime};base64,${(await readFile(asset.original_key)).toString('base64')}`:'';};
let service;const pending=[];let active=0;
function pump(){while(pending.length&&active<5){const jobId=pending.shift();active++;setTimeout(()=>service.consume(jobId).catch(e=>console.error('V4 job failed',e.message)).finally(()=>{active--;pump()}),0);}}
service=createV4Service({viewer:{user:{email:'Local workspace'},account:{id:'local',role:'owner'},csrf:'',isAdmin:false},db:DB,fetchPublic:nodePublicFetch,capabilities:{local:true,get generation(){try{providers.requireReady();return true}catch{return false}},optimizedImages:true,publishing:false,billing:false},localProviders:providers,providerCatalog:async refresh=>(await providers.status({refresh})).providers,snapshotGeneration:()=>providers.selected(),activation:async()=>({active:true,mode:'local'}),requireActivation:async()=>{},enqueue:async id=>{pending.push(id);pump();},
 async saveImage(account,clinic,image){const bytes=Buffer.from(image.bytes),key=join(dir,crypto.randomUUID()),meta=await sharp(bytes).metadata();const originalKey=key+(image.mime==='image/jpeg'?'.jpg':image.mime==='image/webp'?'.webp':'.png'),previewKey=key+'-preview.webp',thumbnailKey=key+'-thumb.webp';await Promise.all([writeFile(originalKey,bytes),sharp(bytes).resize({width:1000,withoutEnlargement:true}).webp({quality:78}).toFile(previewKey),sharp(bytes).resize({width:400,withoutEnlargement:true}).webp({quality:72}).toFile(thumbnailKey)]);return {mime:image.mime,originalKey,previewKey,thumbnailKey,width:meta.width,height:meta.height,size:bytes.length};},
 async readImage(key){try{return {bytes:await readFile(key),mime:key.endsWith('.webp')?'image/webp':key.endsWith('.jpg')?'image/jpeg':'image/png'}}catch{return null}},
 async generateText({generation,prompt,schema,reference,signal}){return withProviderSlot(generation.provider,()=>localStructured({...generation,prompt,schema,reference,signal}),'text');},
 async generateStyle(c,referenceId,jobId,generation,signal,{notes='',currentAssetId=''}={}){const {provider,model}=providers.requireReady(generation);
 const referenceImages=await Promise.all(STYLE_REFERENCES.map(async ref=>`data:image/png;base64,${(await readFile(join(root,'assets','design-systems',ref+'.png'))).toString('base64')}`));
 const current=currentAssetId?await asData(currentAssetId):'';if(current)referenceImages.push(current);
 return parseData(await withProviderSlot(provider,async()=>generateReferenceImage({provider,model,agyModel:agyModel(provider,model),...generation,prompt:stylePrompt(c,referenceId,{notes,revising:Boolean(current)}),referenceImages,logoImage:await asData(c.brand.logoAssetId),signal})));},
 async generateFrame(c,item,frame,style,jobId,generation,signal){const {provider,model}=providers.requireReady(generation);const context={businessPack:{id:'general',name:'Dental clinic'},brand:{name:c.name,primary:c.brand.primary,accent:c.brand.accent},language:c.profile.language||'English',profile:{},recipe:{roles:['Hook','Fact','Advice','Details','CTA']}};const result=parseData(await withProviderSlot(provider,async()=>withImageCancellation(signal,async()=>{signal?.throwIfAborted();return generateSlideImage({...generation,provider,model,contentId:item.id,jobId,prompt:artworkPrompt(c,item,frame),slide:{approved:true,role:item.type,heading:frame.heading,body:frame.body,visualPrompt:frame.visualPrompt},slideNumber:frame.position,contextSnapshot:context,aspectRatio:item.type==='story'?'9:16':item.type==='post'?'1:1':'4:5',brand:context.brand,logoImage:await asData(c.brand.logoAssetId),referenceImage:await asData(style?.asset_id),workDir:storageRoot});},{agyModel:agyModel(provider,model)})));return {bytes:await sharp(result.bytes).resize(1080,item.type==='story'?1920:item.type==='post'?1080:1350,{fit:'contain',background:'#ffffff'}).png().toBuffer(),mime:'image/png'};}
});
export const localV4=service;
export const localDb=DB;
await service.recover();
