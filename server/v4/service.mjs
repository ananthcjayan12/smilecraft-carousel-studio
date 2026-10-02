import {normalizeImageOptions} from '../../web/image-options.js';
import {STYLE_REFERENCES} from './image-prompts.mjs';
import { KNOWLEDGE_CARDS, cardById, rankCards } from './knowledge.mjs';
import {TASKS,sourceBrief,contentContext,briefPrompt,writingPrompt,validationPrompt,briefSchema,writingSchema,validationSchema,checkDraft} from './content-prompts.mjs';
import { publicUrl, publicFetch, extractCandidates } from './extract.mjs';
import { DESIGN_SYSTEMS } from '../../web/design-systems.js';
const now=()=>new Date().toISOString(), id=()=>crypto.randomUUID();
const parse=(value,fallback={})=>{try{return JSON.parse(value)}catch{return fallback}};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,max=200)=>String(v||'').trim().slice(0,max);
const isBriefProcessDescription=value=>/\b(prepared|generated|created|returned|produced)\b.{0,100}\b(brief|json|summary|slides|content)\b|\b(json|planning brief)\b.{0,100}\b(prepared|generated|created|returned)\b|\bwithout (writing|finished) (the )?(slides|content)\b/i.test(String(value||''));
function reviewableBriefSummary(summary,brief){
 const value=text(summary,4000);
 if(value&&!isBriefProcessDescription(value))return value;
 if(brief.origin==='custom'&&text(brief.sourceSummary,4000))return text(brief.sourceSummary,4000);
 return 'See Sources & facts for the patient information behind this topic. You can add your own brief before writing the content.';
}
const viewClinic=r=>r&&({...r,profile:parse(r.profile_json),brand:parse(r.brand_json),styleSelection:parse(r.style_json)});
const viewContent=r=>{
 if(!r)return null;
 const card=cardById(r.knowledge_card_id),angle=card?.engagementAngles.find(a=>a.id===r.angle_id),saved=parse(r.brief_json);
 const brief=saved.origin?saved:{origin:'knowledge',sourceTopic:card?.topic||r.topic,sourceSummary:'',topic:r.topic,summary:'',language:r.language||'English',angle:angle?.label||'',facts:card?.verifiedFacts||[],sources:card?.sources||[],prohibitedClaims:card?.prohibitedClaims||[]};
 brief.prepared=Boolean(text(brief.summary,4000));brief.summary=reviewableBriefSummary(brief.summary,brief);
 return {...r,frames:parse(r.frames_json,[]),brief,validation:parse(r.validation_json),context:parse(r.context_json),feedback:parse(r.feedback_json,[]),sources:brief.sources||[],angle:angle?.label};
};
export function weekStart(value=new Date()) {const d=new Date(value);if(Number.isNaN(d.getTime()))throw fail('Choose a valid week.');d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}
export function createV4Service(platform){
 const controllers=new Map();
 const db=platform.db, first=(sql,...args)=>db.prepare(sql).bind(...args).first(), all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 const write=(sql,args,planning)=>planning?.writes?planning.writes.push(db.prepare(sql).bind(...args)):run(sql,...args);
 const clinic=async(account,clinicId)=>{const c=viewClinic(await first('SELECT * FROM v4_clinics WHERE account_id=? AND id=?',account,clinicId));if(!c)throw fail('Clinic not found.',404);return c;};
 const content=async(account,itemId)=>{const c=viewContent(await first('SELECT * FROM v4_content WHERE account_id=? AND id=?',account,itemId));if(!c)throw fail('Content not found.',404);c.published=Boolean(await first("SELECT id FROM v4_usage WHERE account_id=? AND content_id=? AND status='published' AND knowledge_card_id=? AND headline=? LIMIT 1",account,itemId,c.knowledge_card_id,c.topic));return c;};
 const providerReads=new Map();
 async function providerSettings(account,refresh=false){
  const key=`${account}:${refresh}`;if(providerReads.has(key))return providerReads.get(key);
  const request=readProviderSettings(account,refresh);providerReads.set(key,request);
  try{return await request;}finally{if(providerReads.get(key)===request)providerReads.delete(key);}
 }
 async function readProviderSettings(account,refresh=false){
  const catalog=platform.providerCatalog?await platform.providerCatalog(refresh):{};
  const storedRow=await first('SELECT tasks_json FROM v4_provider_settings WHERE account_id=?',platform.providerSettingsAccount||account);
  const stored=parse((storedRow||await platform.legacyProviderSettings?.())?.tasks_json);
  const legacy=platform.snapshotGeneration?.();const tasks={};
  for(const task of Object.keys(TASKS)){
   const kind=['style','artwork'].includes(task)?'models':'writingModels';
   const preferred=legacy&&catalog[legacy.provider]?.available&&catalog[legacy.provider]?.[kind]?.some(([id])=>id===legacy.model)?legacy:null;
   const provider=preferred?.provider||Object.keys(catalog).find(p=>catalog[p].available&&catalog[p][kind]?.length)||Object.keys(catalog).find(p=>catalog[p][kind]?.length)||'openai';
   tasks[task]=stored[task]||preferred||{provider,model:catalog[provider]?.[kind]?.[0]?.[0]||''};
  }
  return {tasks,providers:catalog};
 }
 async function taskChoice(account,task){
  const settings=await providerSettings(account),choice=settings.tasks[task],entry=settings.providers[choice.provider],models=entry?.[['style','artwork'].includes(task)?'models':'writingModels'];
  if(!entry?.available)throw fail(`${entry?.label||choice.provider} is unavailable for ${TASKS[task]}. Choose an available provider in Settings.`);
  if(!models?.some(([id])=>id===choice.model))throw fail(`Choose a supported model for ${TASKS[task]} in Settings.`);
  return {...choice};
 }
 async function job(account,clinicId,kind,input,{weekId=null,contentId=null,priority=0,key=id()}={}){
  const existing=await first('SELECT * FROM v4_jobs WHERE account_id=? AND request_key=?',account,key);if(existing&&!['cancelled','failed'].includes(existing.status))return existing;if(existing)key=key+':'+id();
  const task=kind==='frame'?'artwork':kind==='brief'?'writing':kind;
  const generation=Object.hasOwn(TASKS,task)?await taskChoice(account,task):undefined;
  const validationGeneration=kind==='writing'?await taskChoice(account,'validation'):undefined;
  const jobId=id();const inserted=await run('INSERT OR IGNORE INTO v4_jobs(id,account_id,clinic_id,week_id,content_id,kind,priority,input_json,created_at,request_key) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM v4_weeks WHERE id=? AND status!=\'cancelled\')',jobId,account,clinicId,weekId,contentId,kind,priority,JSON.stringify({...input,...(generation?{generation}:{}),...(validationGeneration?{validationGeneration}:{})}),now(),key,weekId,weekId);
  if(!inserted.meta.changes)return null;
  try{await platform.enqueue(jobId);}catch{await run("UPDATE v4_jobs SET status='failed',error=? WHERE id=?",'Could not queue work. Retry this task.',jobId);}
  return first('SELECT * FROM v4_jobs WHERE id=?',jobId);
 }
 async function getContent(account,itemId){
  const jobsQuery='SELECT id,kind,status,progress,error FROM v4_jobs WHERE account_id=? AND content_id=? ORDER BY created_at DESC';
  if(db.batch){const [rows,jobs]=await db.batch([
   db.prepare("SELECT c.*,EXISTS(SELECT 1 FROM v4_usage u WHERE u.account_id=c.account_id AND u.content_id=c.id AND u.status='published' AND u.knowledge_card_id=c.knowledge_card_id AND u.headline=c.topic) AS published FROM v4_content c WHERE c.account_id=? AND c.id=?").bind(account,itemId),
   db.prepare(jobsQuery).bind(account,itemId)
  ]);const item=viewContent(rows.results[0]);if(!item)throw fail('Content not found.',404);item.published=Boolean(item.published);return {item,jobs:jobs.results};}
  const [item,jobs]=await Promise.all([content(account,itemId),all(jobsQuery,account,itemId)]);return {item,jobs};
 }
 async function styleFor(account,c,item){const style=await first("SELECT * FROM v4_styles WHERE id=? AND clinic_id=? AND account_id=? AND status='ready'",item.style_id,c.id,account);if(!style)throw fail('Choose a ready style from this clinic.');return style;}
 async function referenceFor(account,c,style){const asset=await first('SELECT * FROM v4_assets WHERE id=? AND account_id=? AND clinic_id=?',style.asset_id,account,c.id);const reference=asset&&await platform.readImage(asset.original_key);if(!reference)throw fail('The selected template reference is unavailable.');return reference;}
 async function updateWeek(account,weekId){
  if(!weekId)return;
  const {week}=await getWeek(account,weekId);if(week.status==='cancelled')return;
  const active=week.items.filter(i=>i.status!=='skipped');
  const status=active.length&&active.every(i=>i.status==='approved')?'approved':week.ready===week.total&&week.total>0?'ready':active.some(i=>['generating'].includes(i.status))?'generating':active.some(i=>['writing','validating'].includes(i.status))?'writing':active.some(i=>['copy_review','failed'].includes(i.status))?'copy-review':'planned';
  await run('UPDATE v4_weeks SET status=?,approved_at=CASE WHEN ?=\'approved\' THEN approved_at ELSE NULL END WHERE id=? AND account_id=? AND status!=\'cancelled\'',status,status,weekId,account);
 }
 async function saveAsset(account,clinicId,image){
  try{const saved=await platform.saveImage(account,clinicId,image),assetId=id();
  await run('INSERT INTO v4_assets(id,account_id,clinic_id,mime,original_key,preview_key,thumbnail_key,width,height,size,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',assetId,account,clinicId,saved.mime,saved.originalKey,saved.previewKey,saved.thumbnailKey,saved.width||null,saved.height||null,saved.size,now());return assetId;}catch(error){await platform.refundImage?.(account,image);throw error;}
 }
 const clinicJobs=(account,clinicId)=>all("SELECT id,kind,status,progress,error FROM v4_jobs j WHERE account_id=? AND clinic_id=? AND (status!='cancelled' OR (kind='style' AND EXISTS(SELECT 1 FROM v4_styles s WHERE s.id=json_extract(j.input_json,'$.styleId') AND s.status='cancelled'))) ORDER BY created_at DESC LIMIT 30",account,clinicId);
 async function styles(account,clinicId){return all('SELECT id,reference_id,name,asset_id,status FROM v4_styles WHERE account_id=? AND clinic_id=? AND status!=? ORDER BY created_at',account,clinicId,'deleted');}
 async function getWeek(account,weekId){
  const queries=[['SELECT * FROM v4_weeks WHERE account_id=? AND id=?',account,weekId],['SELECT * FROM v4_content WHERE account_id=? AND week_id=? ORDER BY position',account,weekId],['SELECT id,kind,content_id,status,progress,error,priority FROM v4_jobs WHERE account_id=? AND week_id=? ORDER BY priority,created_at',account,weekId]];
  let week,rows,jobs;
  if(db.batch){const results=await db.batch(queries.map(([sql,...args])=>db.prepare(sql).bind(...args)));week=results[0].results[0];rows=results[1].results;jobs=results[2].results;}
  else{week=await first(...queries[0]);if(week)[rows,jobs]=await Promise.all(queries.slice(1).map(q=>all(...q)));}
  if(!week)throw fail('Week not found.',404);
  const items=rows.map(viewContent);
  const active=items.filter(i=>i.status!=='skipped'),ready=active.filter(i=>i.frames.length>0&&i.frames.every(f=>f.assetId)).length;
  return {week:{...week,items,jobs,ready,total:active.length,itemCount:items.length,heroReady:Boolean(items[0]?.status!=='skipped'&&items[0]?.frames.length&&items[0].frames.every(f=>f.assetId))}};
 }
 function chooseStyle(c,type,position){const selection=c.styleSelection;return type==='story'?(selection.secondaryStyleIds?.[1]||selection.primaryStyleId):position>0?(selection.secondaryStyleIds?.[0]||selection.primaryStyleId):selection.primaryStyleId;}
 async function newItem(account,c,weekId,type,position,excluded=[],input={},planning=null){
  const custom=Boolean(text(input.customBrief,8000)||text(input.topic,300));
  const history=custom?[]:planning?.history||await all("SELECT u.* FROM v4_usage u WHERE (u.clinic_id=? OR u.generated_at>?) AND (u.status='published' OR EXISTS(SELECT 1 FROM v4_content c WHERE c.id=u.content_id AND c.account_id=u.account_id AND c.knowledge_card_id=u.knowledge_card_id AND c.status!='skipped')) ORDER BY u.generated_at DESC",c.id,new Date(Date.now()-90*86400000).toISOString());
  const choice=custom?null:rankCards(c,history,excluded,type)[0];if(!custom&&!choice)throw fail('No eligible source material is available.');
  const itemId=id(),styleId=text(input.styleId)||chooseStyle(c,type,position),brief=sourceBrief(choice?.card,choice?.angle,c,input),language=c.profile.language||'English';
  if(input.contactKeys&&(!Array.isArray(input.contactKeys)||input.contactKeys.some(k=>!['phone','whatsapp','address','website','bookingUrl'].includes(k))))throw fail('Choose valid CTA contact fields.');
  if(planning){if(!planning.styleIds.has(styleId))throw fail('Choose a ready style from this clinic.');}else{await styleFor(account,c,{style_id:styleId});await taskChoice(account,'writing');}
  await write('INSERT INTO v4_content(id,account_id,clinic_id,week_id,position,type,knowledge_card_id,angle_id,recipe_id,style_id,topic,caption,frames_json,created_at,brief_json,language,status) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM v4_weeks WHERE id=? AND account_id=?)',[itemId,account,c.id,weekId,position,type,choice?.card.id||'',choice?.angle.id||'',`${type}:${choice?.angle.label||'custom'}`,styleId,brief.topic,'','[]',now(),JSON.stringify(brief),language,weekId?'planned':'briefing',weekId,weekId,account],planning);
  if(choice)await recordUsage(account,c,itemId,choice.card.id,choice.angle.id,`${type}:${choice.angle.label}`,brief.topic,'planned',planning);
  if(!weekId)await job(account,c.id,'brief',{revision:1,clinic:c,autoWrite:true},{contentId:itemId,weekId,key:`brief:${itemId}:1`});
  return planning?{id:itemId,knowledge_card_id:choice?.card.id||''}:content(account,itemId);
 }
 async function recordUsage(account,c,itemId,cardId,angleId,recipeId,headline,status,planning=null){await write('INSERT INTO v4_usage(id,account_id,clinic_id,content_id,knowledge_card_id,angle_id,recipe_id,region,headline,status,generated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?'+(planning?' WHERE EXISTS(SELECT 1 FROM v4_content WHERE id=? AND account_id=?)':''),[id(),account,c.id,itemId,cardId,angleId,recipeId,c.profile.location||'',headline,status,now(),...(planning?[itemId,account]:[])],planning);}
 async function plan(account,clinicId,date){
  const c=await clinic(account,clinicId);if(c.status!=='active')throw fail('Confirm clinic facts and choose a primary style first.');
  await taskChoice(account,'writing');
  const start=weekStart(date||new Date()),existing=await first('SELECT id FROM v4_weeks WHERE clinic_id=? AND week_start=?',clinicId,start);if(existing){const data=await getWeek(account,existing.id);if(data.week.itemCount!==7)throw fail('Your content plan is being prepared. Please try again in a moment.',409);return data;}
  // Validate shared inputs once; topic ranking stays sequential to keep the pack unique.
  const [history,readyStyles]=await Promise.all([
   all("SELECT u.* FROM v4_usage u WHERE (u.clinic_id=? OR u.generated_at>?) AND (u.status='published' OR EXISTS(SELECT 1 FROM v4_content c WHERE c.id=u.content_id AND c.account_id=u.account_id AND c.knowledge_card_id=u.knowledge_card_id AND c.status!='skipped')) ORDER BY u.generated_at DESC",c.id,new Date(Date.now()-90*86400000).toISOString()),
   all("SELECT id FROM v4_styles WHERE account_id=? AND clinic_id=? AND status='ready'",account,c.id)
  ]);
  const planning={history,styleIds:new Set(readyStyles.map(s=>s.id)),writes:[]};
  for(const [position,type] of ['carousel','carousel','post','story','story','story','story'].entries())if(!planning.styleIds.has(chooseStyle(c,type,position)))throw fail('Choose a ready style from this clinic.');
  const weekId=id();write('INSERT OR IGNORE INTO v4_weeks(id,account_id,clinic_id,week_start,created_at) VALUES(?,?,?,?,?)',[weekId,account,clinicId,start,now()],planning);
  const excluded=[];for(const [position,type] of ['carousel','carousel','post','story','story','story','story'].entries()){
   const item=await newItem(account,c,weekId,type,position,excluded,{},planning);excluded.push(item.knowledge_card_id);
  }
  const saved=db.batch?await db.batch(planning.writes):await (async()=>{const results=[];for(const statement of planning.writes)results.push(await statement.run());return results;})();
  if(!saved[0].meta.changes){const winner=await first('SELECT id FROM v4_weeks WHERE account_id=? AND clinic_id=? AND week_start=?',account,clinicId,start);return getWeek(account,winner.id);}
  return getWeek(account,weekId);
 }
 async function writeItem(account,item,{autoArtwork=false}={}){
  if(['briefing','writing','validating','generating'].includes(item.status))throw fail('Wait for the current task to finish or cancel it.');
  const c=await clinic(account,item.clinic_id);await Promise.all([styleFor(account,c,item),taskChoice(account,'writing'),taskChoice(account,'validation')]);
  if(item.week_id)await run("UPDATE v4_weeks SET status='writing' WHERE id=? AND account_id=?",item.week_id,account);
  const context=contentContext(c,item),revision=item.revision+1;
  const updated=await run("UPDATE v4_content SET status='writing',copy_status='draft',copy_approved_at=NULL,validation_json='{}',context_json=?,frames_json='[]',caption='',revision=? WHERE id=? AND account_id=? AND revision=?",JSON.stringify(context),revision,item.id,account,item.revision);if(!updated.meta.changes)throw fail('Content changed. Reload before writing.',409);
  await job(account,c.id,'writing',{revision,clinic:c,corrections:item.validation?.issues||[],autoArtwork},{contentId:item.id,weekId:item.week_id,priority:item.position===0?0:1,key:`writing:${item.id}:${revision}`});
 }
 async function queueItem(account,item,priority=1){
  if(item.copy_status!=='approved'||!item.copy_approved_at)throw fail('Review and approve the copy before creating artwork.');
  const c=await clinic(account,item.clinic_id);await Promise.all([styleFor(account,c,item),taskChoice(account,'artwork')]);
  if(JSON.stringify(item.context)!==JSON.stringify(contentContext(c,item)))throw fail('Clinic details changed. Regenerate the copy before creating artwork.');
  const problem=checkDraft(item);if(problem)throw fail(problem);
  await run("UPDATE v4_content SET status='generating' WHERE account_id=? AND id=? AND status!='approved' AND (? IS NULL OR EXISTS(SELECT 1 FROM v4_weeks WHERE id=? AND status!='cancelled'))",account,item.id,item.week_id,item.week_id);
  if(item.frames.every(f=>f.assetId)){await run("UPDATE v4_content SET status='ready' WHERE account_id=? AND id=?",account,item.id);await updateWeek(account,item.week_id);return;}
  await Promise.all(item.frames.filter(f=>!f.assetId).map(f=>job(account,c.id,'frame',{position:f.position,revision:item.revision},{contentId:item.id,weekId:item.week_id,priority,key:`frame:${item.id}:${item.revision}:${f.position}`})));
  await updateWeek(account,item.week_id);
 }
 async function generateWeek(account,weekId,stage='all'){
  const {week}=await getWeek(account,weekId);if(!week.items.length)throw fail('This week has no content.');
  if(week.items.some(i=>['briefing','writing','validating','generating'].includes(i.status)))throw fail('Wait for current tasks to finish.');
  if(!['brief','writing','images','all'].includes(stage))throw fail('Choose briefs, writing, images or full run.');
  await Promise.all([...(stage==='images'?[]:['writing','validation']),...(['images','all'].includes(stage)?['artwork']:[])].map(task=>taskChoice(account,task)));
  await run("UPDATE v4_weeks SET status=? WHERE account_id=? AND id=?",stage==='brief'?'briefing':stage==='images'?'generating':'writing',account,weekId);
  await Promise.all(week.items.map(async item=>{
   if(item.status==='skipped')return;
   if(['brief','writing','all'].includes(stage)&&!item.brief.prepared){const c=await clinic(account,item.clinic_id);await run("UPDATE v4_content SET status='briefing' WHERE id=? AND account_id=?",item.id,account);await job(account,c.id,'brief',{revision:item.revision,clinic:c,autoWrite:true,autoArtwork:stage==='all'},{contentId:item.id,weekId:item.week_id,key:`brief:${item.id}:${item.revision}`});return;}
   if(['brief','writing','all'].includes(stage)){
    if(!item.brief.prepared)throw fail('Prepare all briefs before starting copy.');
    if(item.copy_status==='approved'){if(stage==='all'&&!item.frames.every(f=>f.assetId))await queueItem(account,item,item.position===0?0:1);}
    else if(item.copy_status==='validated'&&stage==='all')await approveCopy(account,item);
    else if(!item.frames.length||item.copy_status==='rejected')await writeItem(account,item,{autoArtwork:stage==='all'});
   }else if(stage==='images'){
    if(item.copy_status==='validated')await approveCopy(account,item);
    else if(item.copy_status==='approved'&&!item.frames.every(f=>f.assetId))await queueItem(account,item,item.position===0?0:1);
   }
  }));
  await updateWeek(account,weekId);return getWeek(account,weekId);
 }
 async function approveCopy(account,item){
  if(item.copy_status!=='validated'||!item.validation.valid)throw fail('Validate the draft before approving its copy.');
  const c=await clinic(account,item.clinic_id);
  if(JSON.stringify(item.context)!==JSON.stringify(contentContext(c,item))||(c.profile.language||'English')!==item.language)throw fail('Clinic details or language changed. Regenerate this copy before approval.');
  await platform.requireActivation(account);await taskChoice(account,'artwork');
  const updated=await run("UPDATE v4_content SET copy_status='approved',copy_approved_at=? WHERE id=? AND account_id=? AND revision=? AND copy_status='validated'",now(),item.id,account,item.revision);if(!updated.meta.changes)throw fail('Content changed. Reload before approving.',409);
  await queueItem(account,await content(account,item.id),item.position===0?0:1);
 }
 async function consume(jobId){
  const target=await first('SELECT * FROM v4_jobs WHERE id=?',jobId);if(!target||target.status!=='queued')return;
  // Claim the delivered job atomically; duplicate or cancelled deliveries do no work.
  const row=await db.prepare("UPDATE v4_jobs SET status='running',started_at=?,lease_until=? WHERE id=? AND status='queued' RETURNING *").bind(now(),Date.now()+600000,target.id).first();
  if(!row)return;
  const input=parse(row.input_json),account=row.account_id;
  const controller=new AbortController();controllers.set(row.id,controller);
  const stillRunning=async()=>Boolean(await first("SELECT id FROM v4_jobs WHERE id=? AND status='running'",row.id));
  const ensureRunning=async(image)=>{if(!await stillRunning()){if(image)await platform.refundImage?.(account,image);throw fail('Generation cancelled.');}};
  // Cloud consumers may run in another isolate; durable status is authoritative.
  let heartbeat=Date.now();
  const poll=setInterval(()=>{stillRunning().then(async running=>{if(!running)controller.abort();else if(Date.now()-heartbeat>30000){heartbeat=Date.now();await run("UPDATE v4_jobs SET lease_until=? WHERE id=? AND status='running'",Date.now()+600000,row.id);}}).catch(()=>{});},1000);

  try{
   const c=await clinic(account,row.clinic_id);let result={};
   if(row.kind==='analyze'){
    const response=await publicFetch(input.website,platform.fetchPublic||fetch);if(!/text\/html/i.test(response.mime))throw fail('This page is not a clinic website. Enter details manually.');const candidates=extractCandidates(new TextDecoder().decode(response.bytes),response.url);
    let logoAssetId='';if(candidates.logoUrl)try{const logo=await publicFetch(candidates.logoUrl,platform.fetchPublic||fetch);if(/^image\/(png|jpeg|webp)/.test(logo.mime))logoAssetId=await saveAsset(account,c.id,{bytes:logo.bytes,mime:logo.mime.split(';')[0]});}catch{}
    // User-entered/confirmed values win if the extractor finishes later.
    const latest=await clinic(account,c.id);
    if(latest.profile.confirmed!==true){await run('UPDATE v4_clinics SET name=?,profile_json=?,brand_json=?,updated_at=?,revision=revision+1 WHERE id=? AND account_id=?',candidates.name||latest.name,JSON.stringify({...latest.profile,...candidates,website:response.url}),JSON.stringify({...latest.brand,primary:candidates.primary,accent:candidates.accent,logoAssetId,bookingUrl:candidates.bookingUrl,website:response.url,phone:candidates.phone,whatsapp:candidates.whatsapp,address:candidates.address}),now(),c.id,account);}
    result={extracted:true};
   }else if(row.kind==='style'){
    const style=await first('SELECT * FROM v4_styles WHERE id=? AND account_id=?',input.styleId,account);if(!style)throw fail('Style not found.',404);
    const image=await platform.generateStyle(c,input.referenceId,row.id,input.generation,controller.signal);await ensureRunning(image);const assetId=await saveAsset(account,c.id,image);await ensureRunning(image);
    await run("UPDATE v4_styles SET asset_id=?,status='ready' WHERE id=? AND account_id=? AND EXISTS(SELECT 1 FROM v4_jobs WHERE id=? AND status='running')",assetId,style.id,account,row.id);result={styleId:style.id};
   }else if(['brief','writing','validation'].includes(row.kind)){
    let item=await content(account,row.content_id);if(item.revision!==input.revision)throw fail('Content changed while writing.');
    const snapshot=input.clinic||c,style=await styleFor(account,snapshot,item);
    if(row.kind==='brief'){
     const resultBrief=await platform.generateText({account,generation:input.generation,prompt:briefPrompt(snapshot,item),schema:briefSchema,signal:controller.signal});await ensureRunning();
     if(!text(resultBrief.topic,300)||!text(resultBrief.summary,4000))throw fail('The writer returned an incomplete brief.');
     await run("UPDATE v4_content SET topic=?,brief_json=?,status='planned' WHERE id=? AND account_id=? AND revision=? AND EXISTS(SELECT 1 FROM v4_jobs WHERE id=? AND status='running')",text(resultBrief.topic,300),JSON.stringify({...item.brief,topic:text(resultBrief.topic,300),summary:reviewableBriefSummary(resultBrief.summary,item.brief)}),item.id,account,input.revision,row.id);
     if(input.autoWrite){await ensureRunning();await writeItem(account,await content(account,item.id),{autoArtwork:Boolean(input.autoArtwork)});}
    }else{
     if(row.kind==='writing'){
      const draft=await platform.generateText({account,generation:input.generation,prompt:writingPrompt(snapshot,{...item,validation:{issues:input.corrections||[]}},style),schema:writingSchema(item.type),reference:await referenceFor(account,snapshot,style),signal:controller.signal});await ensureRunning();
      const contacts=item.context.business.contacts;
      item={...item,topic:text(draft.topic,300),brief:{...item.brief,topic:text(draft.topic,300),summary:text(draft.brief,4000)},frames:draft.frames.map((f,i)=>({...f,position:i+1,assetId:'',approved:false,contacts:i===draft.frames.length-1?contacts:{}})),caption:draft.caption};
     }
     const problem=checkDraft(item);if(problem)throw fail(problem);
     const report=await platform.generateText({account,generation:row.kind==='writing'?input.validationGeneration:input.generation,prompt:validationPrompt(snapshot,item),schema:validationSchema,signal:controller.signal});await ensureRunning();
     if(typeof report.valid!=='boolean'||!Array.isArray(report.issues)||report.valid&&report.issues.length)throw fail('The validator returned an invalid review.');
     const validation={valid:report.valid,issues:report.issues.map(i=>text(i,600)),at:now(),provider:(row.kind==='writing'?input.validationGeneration:input.generation).provider};
     await run("UPDATE v4_content SET topic=?,brief_json=?,frames_json=?,caption=?,copy_status=?,validation_json=?,status='copy_review' WHERE id=? AND account_id=? AND revision=? AND EXISTS(SELECT 1 FROM v4_jobs WHERE id=? AND status='running')",item.topic,JSON.stringify(item.brief),JSON.stringify(item.frames),item.caption,validation.valid?'validated':'rejected',JSON.stringify(validation),item.id,account,input.revision,row.id);
     await run("UPDATE v4_usage SET headline=? WHERE content_id=? AND account_id=? AND status!='published'",item.frames[0].heading,item.id,account);
     if(validation.valid&&item.week_id&&input.autoArtwork){await ensureRunning();await approveCopy(account,await content(account,item.id));}
    }
    await updateWeek(account,item.week_id);result={contentId:item.id};
   }else if(row.kind==='frame'){
    let item=await content(account,row.content_id);if(item.revision!==input.revision)throw fail('Content changed while generating.');
    if(item.copy_status!=='approved'||!item.copy_approved_at)throw fail('Copy approval is required before artwork generation.');
    const frame=item.frames.find(f=>f.position===input.position);if(!frame)throw fail('Frame not found.');
    if(!frame.assetId){
     const image=await platform.generateFrame(c,item,frame,await first('SELECT * FROM v4_styles WHERE id=? AND clinic_id=? AND account_id=?',item.style_id,c.id,account),row.id,input.generation,controller.signal);
     await ensureRunning(image);const assetId=await saveAsset(account,c.id,image);await ensureRunning(image);
     // Retry compare-and-swap so concurrent frame completions cannot overwrite each other.
     let attached=false;for(let attempt=0;attempt<8;attempt++){
      item=await content(account,row.content_id);if(item.revision!==input.revision)throw fail('Content changed while generating.');
      const frames=item.frames.map(f=>f.position===input.position?{...f,assetId,approved:false}:f),ready=frames.every(f=>f.assetId);
      const saved=await run("UPDATE v4_content SET frames_json=?,status=?,revision=revision WHERE id=? AND account_id=? AND revision=? AND frames_json=? AND EXISTS(SELECT 1 FROM v4_jobs WHERE id=? AND status='running')",JSON.stringify(frames),ready?'ready':'generating',item.id,account,item.revision,JSON.stringify(item.frames),row.id);
      if(saved.meta.changes){attached=true;break;}
     }
     if(!attached)throw fail('Could not attach artwork. Retry this frame.');
    }
    item=await content(account,row.content_id);
    if(item.frames.every(f=>f.assetId)){
     await run("UPDATE v4_usage SET status='generated' WHERE content_id=? AND account_id=? AND status='planned'",item.id,account);
     await updateWeek(account,item.week_id);
    }
    result={contentId:item.id,position:input.position};
   }
   await run("UPDATE v4_jobs SET status='succeeded',progress=100,result_json=?,finished_at=? WHERE id=? AND status='running'",JSON.stringify(result),now(),row.id);
  }catch(error){
   if(!await stillRunning())return;
   const message=text(error.message,400);const failed=await run("UPDATE v4_jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status='running'",message,now(),row.id);if(!failed.meta.changes)return;
   if(row.kind==='style')await run("UPDATE v4_styles SET status='failed' WHERE id=? AND account_id=?",input.styleId,account);
   if(row.content_id)await run("UPDATE v4_content SET status='failed' WHERE id=? AND account_id=? AND revision=?",row.content_id,account,input.revision);
   if(row.content_id){const failedItem=await content(account,row.content_id);await updateWeek(account,failedItem.week_id);}
  }finally{clearInterval(poll);controllers.delete(row.id);}
 }
 async function generateStyles(account,clinicId){
  await taskChoice(account,'style');
  const c=await clinic(account,clinicId),existing=await all('SELECT reference_id FROM v4_styles WHERE account_id=? AND clinic_id=?',account,clinicId);
  const ranked=[...STYLE_REFERENCES,...DESIGN_SYSTEMS.map(d=>d.id)].filter((v,i,a)=>a.indexOf(v)===i);
  const next=ranked.filter(r=>!existing.some(s=>s.reference_id===r)).slice(0,3);
  await Promise.all(next.map(async referenceId=>{const styleId=id();const inserted=await run('INSERT OR IGNORE INTO v4_styles(id,account_id,clinic_id,reference_id,name,created_at) VALUES(?,?,?,?,?,?)',styleId,account,clinicId,referenceId,DESIGN_SYSTEMS.find(d=>d.id===referenceId).name,now());if(!inserted.meta.changes)return;await job(account,clinicId,'style',{styleId,referenceId},{priority:0,key:`style:${clinicId}:${referenceId}`});}));
  return {styles:await styles(account,clinicId)};
 }
 async function cancelJobs(account,clinicId,weekId=null){
  if(weekId)await run("UPDATE v4_weeks SET status='cancelled' WHERE id=? AND account_id=? AND status IN ('hero-generating','generating','briefing','writing','copy-review','planned')",weekId,account);
  const scope=weekId?'week_id=?':"clinic_id=? AND kind='style'",scopeId=weekId||clinicId;
  const cancelled=(await db.prepare(`UPDATE v4_jobs SET status='cancelled',request_key=request_key||':cancelled:'||id,error='Generation cancelled.',finished_at=? WHERE account_id=? AND ${scope} AND status IN ('queued','running') RETURNING *`).bind(now(),account,scopeId).all()).results;
  for(const j of cancelled){controllers.get(j.id)?.abort();if(j.kind==='style')await run("UPDATE v4_styles SET status='cancelled' WHERE id=? AND status='generating'",parse(j.input_json).styleId);}
  if(weekId){await run("UPDATE v4_weeks SET status='cancelled' WHERE id=? AND account_id=? AND status IN ('hero-generating','generating','briefing','writing','copy-review','planned')",weekId,account);await run("UPDATE v4_content SET status='cancelled' WHERE week_id=? AND account_id=? AND status IN ('generating','writing','briefing','validating')",weekId,account);}
  return {ok:true,cancelled:cancelled.length};
 }
 async function approveItem(account,itemId){
  const item=await content(account,itemId);if(!item.frames.length||!item.frames.every(f=>f.assetId))throw fail('Wait for all artwork before approving.');
  if(item.copy_status!=='approved')throw fail('Approve the copy before approving artwork.');
  await run("UPDATE v4_content SET status='approved',frames_json=? WHERE id=? AND account_id=?",JSON.stringify(item.frames.map(f=>({...f,approved:true}))),itemId,account);
  await run("UPDATE v4_usage SET status='approved' WHERE content_id=? AND account_id=? AND status!='published'",itemId,account);await updateWeek(account,item.week_id);return {item:await content(account,itemId)};
 }
 async function route(request,account,url){
  const parts=url.pathname.slice('/api/v4'.length).split('/').filter(Boolean),method=request.method;
  const body=async()=>{const raw=await request.text();if(raw.length>65000)throw fail('Request too large.',413);let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON.');}if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Expected an object.');return input;};
  const json=data=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
  if(parts[0]==='bootstrap'&&method==='GET'){
   const [rows,activation]=await Promise.all([all('SELECT * FROM v4_clinics WHERE account_id=? ORDER BY updated_at DESC',account),platform.activation(account)]);
   const clinics=rows.map(viewClinic),selected=clinics.find(c=>c.id===url.searchParams.get('clinic'))||clinics[0]||null;
   const include=url.searchParams.get('include');let workspace;
   if(selected&&include==='clinic'){
    const [available,jobs]=await Promise.all([styles(account,selected.id),clinicJobs(account,selected.id)]);
    workspace={clinic:selected,styles:available,jobs};
   }
   return json({clinics,activation,capabilities:platform.capabilities,...(platform.viewer?{me:platform.viewer}:{}),...(workspace?{workspace}:{})});
  }
  if(parts[0]==='local-providers'&&parts.length===1&&platform.localProviders){
   if(method==='GET')return json(await platform.localProviders.status({refresh:url.searchParams.get('refresh')==='1'}));
   if(method==='PUT')return json(await platform.localProviders.save(await body()));
  }
  if(parts[0]==='providers'&&parts.length===1){
   await platform.authorizeProviderSettings?.();
   if(method==='GET')return json(await providerSettings(account,url.searchParams.get('refresh')==='1'));
   if(method==='PUT'){
    const input=await body(),catalog=(await providerSettings(account,true)).providers,tasks={};
    for(const task of Object.keys(TASKS)){
     const choice=input.tasks?.[task],entry=catalog[choice?.provider],kind=['style','artwork'].includes(task)?'models':'writingModels';
     if(!entry?.available||!entry[kind]?.some(([id])=>id===choice.model))throw fail(`Choose an available provider and supported model for ${TASKS[task]}.`);
     tasks[task]={provider:choice.provider,model:choice.model,...(['style','artwork'].includes(task)?normalizeImageOptions(choice):{})};
    }
    await run('INSERT INTO v4_provider_settings(account_id,tasks_json,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET tasks_json=excluded.tasks_json,revision=revision+1,updated_at=excluded.updated_at',platform.providerSettingsAccount||account,JSON.stringify(tasks),now());return json(await providerSettings(account));
   }
  }
  if(parts[0]==='knowledge'&&method==='GET')return json({cards:KNOWLEDGE_CARDS});
  if(parts[0]==='clinics'&&parts.length===1&&method==='POST'){
   const input=await body();if(input.website)publicUrl(input.website);
   const clinicId=id(),created=now();await run('INSERT INTO v4_clinics(id,account_id,name,profile_json,brand_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',clinicId,account,text(input.name,100)||'Your clinic',JSON.stringify({website:text(input.website,500),instagram:text(input.instagram,100),goal:'Educate existing patients',services:[],facts:[]}),JSON.stringify({primary:'#5b5bd6',accent:'#8bd5cf'}),created,created);
   const analysis=input.website?await job(account,clinicId,'analyze',{website:input.website}):null;
   return json({clinic:await clinic(account,clinicId),job:analysis?{id:analysis.id,status:analysis.status}:null});
  }
  if(parts[0]==='clinics'&&parts[1]){
   const c=await clinic(account,parts[1]);
   if(parts.length===2&&method==='GET'){const [available,jobs]=await Promise.all([styles(account,c.id),clinicJobs(account,c.id)]);return json({clinic:c,styles:available,jobs});}
   if(parts[2]==='profile'&&method==='PUT'){
    const input=await body();if(Number(input.revision)!==c.revision)throw fail('Clinic details changed. Reload before saving.',409);
    const profile={...c.profile,goal:text(input.goal||c.profile.goal),emphasis:text(input.emphasis||c.profile.emphasis),location:text(input.location??c.profile.location),services:Array.isArray(input.services)?input.services.map(s=>text(s,80)).slice(0,20):c.profile.services,tone:text(input.tone||c.profile.tone),language:text(input.language??c.profile.language??'English',120)||'English',confirmed:Boolean(input.confirmed||c.profile.confirmed),facts:Array.isArray(input.facts)?input.facts.map(f=>({text:text(f.text,400),status:input.confirmed?'verified':'unverified',source:text(f.source,500)})).slice(0,20):c.profile.facts};
    const brand={...c.brand};for(const k of ['primary','accent'])if(/^#[0-9a-f]{6}$/i.test(input[k]||''))brand[k]=input[k];
    if(input.bookingUrl!==undefined){if(input.bookingUrl)publicUrl(input.bookingUrl);brand.bookingUrl=text(input.bookingUrl,500);}for(const key of ['phone','whatsapp','address'])if(input[key]!==undefined)brand[key]=text(input[key],key==='address'?500:50);if(input.website!==undefined){if(input.website)publicUrl(input.website);brand.website=text(input.website,500);}
    const selected=Boolean(c.styleSelection.primaryStyleId),status=profile.confirmed&&selected?'active':'onboarding';
    await run('UPDATE v4_clinics SET name=?,profile_json=?,brand_json=?,status=?,revision=revision+1,updated_at=? WHERE account_id=? AND id=? AND revision=?',text(input.name||c.name,100),JSON.stringify(profile),JSON.stringify(brand),status,now(),account,c.id,c.revision);return json({clinic:await clinic(account,c.id)});
   }
   if(parts[2]==='logo'&&method==='POST'){
    const bytes=new Uint8Array(await request.arrayBuffer()),mime=request.headers.get('content-type');if(!['image/png','image/jpeg','image/webp'].includes(mime)||bytes.length>2_000_000)throw fail('Choose a PNG, JPEG or WebP logo under 2 MB.');
    const logoAssetId=await saveAsset(account,c.id,{bytes,mime});await run('UPDATE v4_clinics SET brand_json=?,revision=revision+1,updated_at=? WHERE account_id=? AND id=?',JSON.stringify({...c.brand,logoAssetId,...Object.fromEntries(['primary','accent'].map(k=>[k,request.headers.get('X-Logo-'+k)]).filter(([,v])=>/^#[0-9a-f]{6}$/i.test(v||'')))}),now(),account,c.id);return json({clinic:await clinic(account,c.id)});
   }
   if(parts[2]==='styles'&&parts[3]==='cancel'&&method==='POST')return json(await cancelJobs(account,c.id));
   if(parts[2]==='styles'&&method==='POST'){await platform.requireActivation(account);return json(await generateStyles(account,c.id));}
   if(parts[2]==='styles'&&parts[3]&&method==='DELETE'){
    const selected=[c.styleSelection.primaryStyleId,...(c.styleSelection.secondaryStyleIds||[])];if(selected.includes(parts[3]))throw fail('Choose another primary or supporting style before removing this one.');
    const removed=await run("UPDATE v4_styles SET status='deleted' WHERE id=? AND account_id=? AND clinic_id=? AND status='ready'",parts[3],account,c.id);if(!removed.meta.changes)throw fail('Ready style not found.',404);return json({styles:await styles(account,c.id)});
   }
   if(parts[2]==='style-selection'&&method==='PUT'){
    const input=await body(),available=await styles(account,c.id),primaryStyleId=text(input.primaryStyleId),secondaryStyleIds=[...new Set(input.secondaryStyleIds||[])].filter(v=>v!==primaryStyleId).slice(0,2);
    if(![primaryStyleId,...secondaryStyleIds].every(v=>available.some(s=>s.id===v&&s.status==='ready')))throw fail('Choose a ready style from this clinic.');
    await run('UPDATE v4_clinics SET style_json=?,status=?,revision=revision+1,updated_at=? WHERE account_id=? AND id=?',JSON.stringify({primaryStyleId,secondaryStyleIds}),c.profile.confirmed?'active':'onboarding',now(),account,c.id);return json({clinic:await clinic(account,c.id)});
   }
   if(parts[2]==='content'&&parts.length===3&&method==='POST'){
    const input=await body();if(c.status!=='active')throw fail('Confirm clinic details and select a ready style first.');
    if(!['carousel','story','post'].includes(input.type))throw fail('Choose Carousel, Story or Post.');
    if(!text(input.topic,300)&&!text(input.customBrief,8000))throw fail('Enter a content topic.');
    return json({item:await newItem(account,c,null,input.type,0,[],{...input,topic:text(input.topic,300),customBrief:text(input.customBrief,8000)})});
   }
   if(parts[2]==='weeks'&&method==='POST')return json(await plan(account,c.id,(await body()).weekStart));
   if(parts[2]==='weeks'&&method==='GET'){
    if(url.searchParams.get('latest')==='1'){const latest=await first('SELECT id FROM v4_weeks WHERE account_id=? AND clinic_id=? ORDER BY week_start DESC LIMIT 1',account,c.id);return json(latest?await getWeek(account,latest.id):{week:null});}
    return json({weeks:await all('SELECT * FROM v4_weeks WHERE account_id=? AND clinic_id=? ORDER BY week_start DESC LIMIT 30',account,c.id)});
   }
   if(parts[2]==='library'&&method==='GET'){
    const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),query='SELECT * FROM v4_content WHERE account_id=? AND clinic_id=? ORDER BY created_at DESC,position LIMIT 30 OFFSET ?';
    if(url.searchParams.get('weeks')==='1'){
     const weeksQuery='SELECT * FROM v4_weeks WHERE account_id=? AND clinic_id=? ORDER BY week_start DESC LIMIT 30';
     const [rows,weeks]=db.batch?(await db.batch([db.prepare(query).bind(account,c.id,offset),db.prepare(weeksQuery).bind(account,c.id)])).map(r=>r.results):await Promise.all([all(query,account,c.id,offset),all(weeksQuery,account,c.id)]);
     return json({items:rows.map(viewContent),weeks});
    }
    return json({items:(await all(query,account,c.id,offset)).map(viewContent)});
   }
  }
  if(parts[0]==='weeks'&&parts[1]){
   const {week}=await getWeek(account,parts[1]);
   if(parts.length===2&&method==='GET')return json({week});
   if(parts.length===2&&method==='DELETE'){
    await cancelJobs(account,week.clinic_id,week.id);
    await run('DELETE FROM v4_jobs WHERE account_id=? AND week_id=?',account,week.id);
    await run('DELETE FROM v4_content WHERE account_id=? AND week_id=?',account,week.id);
    await run('DELETE FROM v4_weeks WHERE account_id=? AND id=?',account,week.id);
    return json({ok:true});
   }
   if(parts[2]==='cancel'&&method==='POST'){await cancelJobs(account,week.clinic_id,week.id);return json(await getWeek(account,week.id));}
   if(parts[2]==='generate'&&method==='POST'){const input=await body();await platform.requireActivation(account);return json(await generateWeek(account,week.id,input.stage||'all'));}
   if(parts[2]==='approve'&&method==='POST'){
    const active=week.items.filter(i=>i.status!=='skipped');if(!active.length||!active.every(i=>i.frames.length>0&&i.frames.every(f=>f.assetId)))throw fail('All active weekly artwork must be ready before approval.');
    for(const item of active)await approveItem(account,item.id);
    await run("UPDATE v4_weeks SET status='approved',approved_at=? WHERE account_id=? AND id=?",now(),account,week.id);return json(await getWeek(account,week.id));
   }
  }
  if(parts[0]==='content'&&parts[1]){
   const item=await content(account,parts[1]),c=await clinic(account,item.clinic_id);
   if(parts.length===2&&method==='GET')return json(await getContent(account,item.id));
   if(parts[2]==='write'&&method==='POST'){
    if(!item.brief.prepared){
     if(['briefing','writing','validating','generating'].includes(item.status))throw fail('Wait for the current task to finish or cancel it.');
     await taskChoice(account,'writing');await taskChoice(account,'validation');
     await run("UPDATE v4_content SET status='briefing' WHERE id=? AND account_id=?",item.id,account);
     await job(account,c.id,'brief',{revision:item.revision,clinic:c,autoWrite:true},{contentId:item.id,weekId:item.week_id,key:`brief:${item.id}:${item.revision}`});
    }else await writeItem(account,item);
    return json(await getContent(account,item.id));
   }
   if(parts[2]==='generate'&&method==='POST'){
    await platform.requireActivation(account);
    // An explicit request resumes this item even when its week was stopped.
    if(item.week_id)await run("UPDATE v4_weeks SET status='planned' WHERE id=? AND account_id=? AND status='cancelled'",item.week_id,account);
    if(item.week_id&&item.copy_status==='validated')await approveCopy(account,item);
    else await queueItem(account,item,0);
    return json(await getContent(account,item.id));
   }
   if(parts[2]==='approve-copy'&&method==='POST'){await approveCopy(account,item);return json(await getContent(account,item.id));}
   if(parts[2]==='approve'&&method==='POST')return json(await approveItem(account,item.id));
   if(parts[2]==='publish'&&method==='POST'){
    if(item.published)return json(await getContent(account,item.id));
    if(item.status==='skipped'||!item.frames.length||!item.frames.every(f=>f.assetId))throw fail('Finish the artwork before marking it as published.');
    await run("INSERT OR IGNORE INTO v4_usage(id,account_id,clinic_id,content_id,knowledge_card_id,angle_id,recipe_id,region,headline,status,generated_at) VALUES(?,?,?,?,?,?,?,?,?,'published',?)",`published:${item.id}:${item.revision}`,account,c.id,item.id,item.knowledge_card_id,item.angle_id,item.recipe_id,c.profile.location||'',item.topic,now());
    return json(await getContent(account,item.id));
   }
   if(parts[2]==='cancel'&&method==='POST'){
    const jobs=await all("SELECT id FROM v4_jobs WHERE account_id=? AND content_id=? AND status IN ('queued','running')",account,item.id);
    for(const j of jobs){await run("UPDATE v4_jobs SET status='cancelled',request_key=request_key||':cancelled:'||id,error='Generation cancelled.' WHERE id=?",j.id);controllers.get(j.id)?.abort();}
    await run("UPDATE v4_content SET status='cancelled' WHERE id=? AND account_id=?",item.id,account);await updateWeek(account,item.week_id);return json(await getContent(account,item.id));
   }
   if(parts[2]==='skip'&&method==='POST'){
    if(!item.week_id)throw fail('Only weekly content can be skipped.');
    const jobs=await all("SELECT id FROM v4_jobs WHERE account_id=? AND content_id=? AND status IN ('queued','running','failed','cancelled')",account,item.id);
    for(const j of jobs){await run("UPDATE v4_jobs SET status='cancelled',request_key=request_key||':cancelled:'||id,error='Content skipped.',finished_at=? WHERE id=?",now(),j.id);controllers.get(j.id)?.abort();}
    await run("UPDATE v4_content SET status='skipped' WHERE id=? AND account_id=?",item.id,account);await updateWeek(account,item.week_id);return json(await content(account,item.id));
   }
   if(parts[2]==='restart'&&method==='POST'){
    if(!item.week_id)throw fail('Only weekly content can be restarted.');
    if(['briefing','writing','validating','generating'].includes(item.status))throw fail('Stop the current task before restarting this item.');
    const input=await body(),stage=input.stage||(!item.brief.prepared?'brief':item.copy_status==='rejected'||!item.frames.length?'writing':'images');
    if(!['brief','writing','images'].includes(stage))throw fail('Choose a valid restart step.');
    await run("UPDATE v4_weeks SET status='planned',approved_at=NULL WHERE id=? AND account_id=?",item.week_id,account);
    if(stage==='brief'){
     const revision=item.revision+1,brief={...item.brief,summary:''};
     await run("UPDATE v4_content SET brief_json=?,frames_json='[]',caption='',copy_status='draft',validation_json='{}',context_json='{}',copy_approved_at=NULL,status='briefing',revision=? WHERE id=? AND account_id=?",JSON.stringify(brief),revision,item.id,account);
     await job(account,c.id,'brief',{revision,clinic:c,autoWrite:true},{contentId:item.id,weekId:item.week_id,key:`brief:${item.id}:${revision}`});
    }else if(stage==='writing')await writeItem(account,{...item,status:'planned'});
    else{
     if(!['approved','validated'].includes(item.copy_status))throw fail('Prepare and approve the copy before restarting artwork.');
     await run("UPDATE v4_content SET status='planned',frames_json=? WHERE id=? AND account_id=?",JSON.stringify(item.frames.map(f=>({...f,assetId:'',approved:false}))),item.id,account);
     const fresh=await content(account,item.id);if(fresh.copy_status==='validated')await approveCopy(account,fresh);else await queueItem(account,fresh,0);
    }
    await updateWeek(account,item.week_id);return json(await content(account,item.id));
   }
   if(parts[2]==='brief'&&method==='PUT'||parts[2]==='replace'&&method==='POST'){
    const input=await body();if(['briefing','writing','validating','generating'].includes(item.status))throw fail('Cancel the current task before changing the brief.');
    if(parts[2]==='brief'&&Number(input.revision)!==item.revision)throw fail('Content changed. Reload before editing.',409);
    let brief,cardId='',angleId='';
    if(parts[2]==='replace'){
     const others=item.week_id?(await getWeek(account,item.week_id)).week.items.filter(i=>i.status!=='skipped').map(i=>i.knowledge_card_id):[item.knowledge_card_id];
     const choice=rankCards(c,await all("SELECT u.* FROM v4_usage u WHERE (u.clinic_id=? OR u.generated_at>?) AND (u.status='published' OR EXISTS(SELECT 1 FROM v4_content c WHERE c.id=u.content_id AND c.account_id=u.account_id AND c.knowledge_card_id=u.knowledge_card_id AND c.status!='skipped'))",c.id,new Date(Date.now()-90*86400000).toISOString()),others,item.type)[0];if(!choice)throw fail('No new topic is available.');
     brief=sourceBrief(choice.card,choice.angle,c);cardId=choice.card.id;angleId=choice.angle.id;
    }else{
     if(!text(input.topic,300)&&!text(input.customBrief,8000))throw fail('Enter a content topic.');
     if(input.contactKeys&&(!Array.isArray(input.contactKeys)||input.contactKeys.some(k=>!['phone','whatsapp','address','website','bookingUrl'].includes(k))))throw fail('Choose valid CTA contact fields.');
     brief=sourceBrief(null,null,c,{...input,customBrief:text(input.customBrief,8000),topic:text(input.topic,300)});
    }
    const styleId=text(input.styleId)||item.style_id;await styleFor(account,c,{style_id:styleId});await taskChoice(account,'writing');
    const revision=item.revision+1;const saved=await run("UPDATE v4_content SET knowledge_card_id=?,angle_id=?,recipe_id=?,style_id=?,topic=?,brief_json=?,language=?,caption='',frames_json='[]',copy_status='draft',validation_json='{}',context_json='{}',copy_approved_at=NULL,status=?,revision=? WHERE id=? AND account_id=? AND revision=?",cardId,angleId,`${item.type}:${brief.angle}`,styleId,brief.topic,JSON.stringify(brief),c.profile.language||'English',parts[2]==='replace'?'planned':'briefing',revision,item.id,account,item.revision);if(!saved.meta.changes)throw fail('Content changed. Reload before editing.',409);
    await run("UPDATE v4_usage SET status='rejected' WHERE content_id=? AND account_id=? AND status!='published'",item.id,account);
    if(cardId)await recordUsage(account,c,item.id,cardId,angleId,`${item.type}:${brief.angle}`,brief.topic,'planned');
    if(item.week_id)await run("UPDATE v4_weeks SET status='planned',approved_at=NULL WHERE id=? AND account_id=?",item.week_id,account);
    if(parts[2]!=='replace')await job(account,c.id,'brief',{revision,clinic:c,autoWrite:true},{weekId:item.week_id,contentId:item.id,key:`brief:${item.id}:${revision}`});return json(await getContent(account,item.id));
   }
   if(parts.length===2&&method==='PUT'){
    const input=await body();if(Number(input.revision)!==item.revision)throw fail('Content changed. Reload before editing.',409);
    if(['briefing','writing','validating','generating'].includes(item.status))throw fail('Cancel or wait for the current task before editing.');
    if(!item.frames.length)throw fail('Generate a draft before editing copy.');
    if(!Array.isArray(input.frames)||input.frames.length!==item.frames.length)throw fail('Supply every frame before saving copy.');
    const frames=item.frames.map((f,i)=>({...f,heading:text(input.frames[i].heading,120),body:text(input.frames[i].body,500),visualPrompt:text(input.frames[i].visualPrompt??f.visualPrompt,650),approved:false,...(input.frames[i].heading!==f.heading||input.frames[i].body!==f.body||input.frames[i].visualPrompt&&input.frames[i].visualPrompt!==f.visualPrompt?{assetId:''}:{})})),caption=text(input.caption,4000);
    const context=contentContext(c,item);frames.forEach((f,i)=>f.contacts=i===frames.length-1?context.business.contacts:{});
    const problem=checkDraft({...item,frames,caption});if(problem)throw fail(problem);await taskChoice(account,'validation');
    const revision=item.revision+1;const saved=await run("UPDATE v4_content SET frames_json=?,caption=?,context_json=?,copy_status='draft',validation_json='{}',copy_approved_at=NULL,status='validating',revision=? WHERE id=? AND account_id=? AND revision=?",JSON.stringify(frames),caption,JSON.stringify(context),revision,item.id,account,item.revision);if(!saved.meta.changes)throw fail('Content changed. Reload before editing.',409);
    if(item.week_id)await run("UPDATE v4_weeks SET status='writing',approved_at=NULL WHERE id=? AND account_id=?",item.week_id,account);
    await job(account,c.id,'validation',{revision,clinic:c},{weekId:item.week_id,contentId:item.id,key:`validation:${item.id}:${revision}`});return json(await getContent(account,item.id));
   }
  }
  if(parts[0]==='jobs'&&parts[1]&&parts[2]==='retry'&&method==='POST'){
   const j=await first('SELECT * FROM v4_jobs WHERE id=? AND account_id=?',parts[1],account);if(!j)throw fail('Job not found.',404);if(!['failed','cancelled'].includes(j.status))throw fail('Only failed or cancelled jobs can be retried.');if(['frame','style'].includes(j.kind))await platform.requireActivation(account);
   if(j.content_id){
    const item=await content(account,j.content_id);if(item.revision!==parse(j.input_json).revision)throw fail('This task belongs to an older draft. Use the current content controls instead.');
    if(item.week_id)await run("UPDATE v4_weeks SET status='planned' WHERE id=? AND account_id=? AND status='cancelled'",item.week_id,account);
    await run('UPDATE v4_content SET status=? WHERE id=? AND account_id=?',j.kind==='frame'?'generating':j.kind==='brief'?'briefing':j.kind==='validation'?'validating':'writing',item.id,account);
   }
   if(j.kind==='style')await run("UPDATE v4_styles SET status='generating' WHERE id=? AND account_id=?",parse(j.input_json).styleId,account);
   await run("UPDATE v4_jobs SET status='queued',error=NULL,finished_at=NULL WHERE id=? AND account_id=?",j.id,account);if(j.kind==='style')await run("UPDATE v4_styles SET status='generating' WHERE id=?",parse(j.input_json).styleId);
   try{await platform.enqueue(j.id)}catch{await run("UPDATE v4_jobs SET status='failed',error=? WHERE id=? AND account_id=?",'Could not queue work. Please retry.',j.id,account);throw fail('Could not queue work. Please retry.',503);}return json({ok:true});
  }
  if(parts[0]==='assets'&&parts[1]&&method==='GET'){
   const asset=await first('SELECT * FROM v4_assets WHERE account_id=? AND id=?',account,parts[1]);if(!asset)throw fail('Image not found.',404);
   const variant=parts[2]||'preview',key=variant==='original'?asset.original_key:variant==='thumbnail'?asset.thumbnail_key:asset.preview_key;
   const object=await platform.readImage(key);if(!object)throw fail('Image unavailable.',404);
   return new Response(object.bytes,{headers:{'Content-Type':object.mime||asset.mime,'Cache-Control':'private,max-age=3600','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
  }
  throw fail('Route not found.',404);
 }
 return {route,consume,clinic,getWeek,plan,saveAsset,async recover(){await run("UPDATE v4_jobs SET status='queued',error='Recovered interrupted work.' WHERE status='running' AND lease_until<? ",Date.now());const rows=await all("SELECT id FROM v4_jobs WHERE status='queued'");for(const r of rows)await platform.enqueue(r.id);}};
}
