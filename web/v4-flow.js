async function refreshClient() {
  const data=await request(`/api/clients/${S.client.id}`);
  S.client=data.client;
  const i=S.clients.findIndex(x=>x.id===S.client.id);
  if(i>=0) S.clients[i]=S.client;
}
async function saveAnalysisAsClient() {
  const a=S.onboarding.analysis;
  const created=await request('/api/clients',{
    name:a.name||'My Dental Clinic',
    businessPackId:'dental',
    profile:{website:a.website,instagram:a.instagram,services:a.services,description:a.description,v4Goal:S.onboarding.goal,v4Frequency:S.onboarding.frequency,v4Onboarding:true},
    brand:{name:a.name||'My Dental Clinic',phone:a.phone||'',location:a.location||'',primary:a.primary||'#5b5bd6',accent:a.accent||'#14b8a6'}
  });
  S.client=created.client; S.clients=[S.client,...S.clients.filter(x=>x.id!==S.client.id)];
  if(a.logoImage){
    try{
      const up=await request(`/api/clients/${S.client.id}/assets`,{kind:'logo',name:'clinic-logo',image:a.logoImage});
      const patched=await request(`/api/clients/${S.client.id}`,{expectedRevision:S.client.revision,brand:{logoAssetId:up.asset.id}},'PATCH');
      S.client=patched.client;
    }catch(e){ console.warn('Logo import skipped',e); }
  }
}
async function generateStylesBatch(reset=false) {
  if(reset) S.onboarding.styles=[];
  const start=S.onboarding.styleBatch*3;
  const picks=designCatalog.slice(start,start+3).length===3?designCatalog.slice(start,start+3):designCatalog.slice(0,3);
  S.onboarding.styles=picks.map(([id,name,description])=>({id,name,description,image:''}));
  S.onboarding.primaryIndex=0; render();
  const a=S.onboarding.analysis,b=S.client?.brand||{};
  const [imageProvider,imageModel]=provider('image');
  await Promise.all(S.onboarding.styles.map(async style=>{
    try{
      const result=await request(`/api/clients/${S.client.id}/style-maker/render`,{
        designId:style.id,name:S.client.name,businessType:'Dental clinic',primary:b.primary||a.primary||'#5b5bd6',accent:b.accent||a.accent||'#14b8a6',
        language:'English',direction:`Create a polished reusable social media system for ${S.client.name}. Keep it modern, clean and trustworthy.`,
        logoImage:a.logoImage||'',provider:imageProvider,model:imageModel
      });
      style.image=result.image;
    }catch(error){ style.error=error.message; }
    render();
  }));
}
async function saveStyles() {
  S.busy='saving-styles'; render();
  try{
    const ordered=[S.onboarding.styles[S.onboarding.primaryIndex],...S.onboarding.styles.filter((_,i)=>i!==S.onboarding.primaryIndex)];
    const saved=[];
    for(const style of ordered){
      if(!style?.image) continue;
      const response=await request(`/api/clients/${S.client.id}/templates`,{name:`V4 · ${style.name}`,image:style.image});
      saved.push(response.template.id);
    }
    S.onboarding.savedStyleIds=saved;
    await refreshClient();
    const patched=await request(`/api/clients/${S.client.id}`,{expectedRevision:S.client.revision,profile:{v4PrimaryStyleId:saved[0]||'',v4StyleIds:saved,v4Onboarded:true}},'PATCH');
    S.client=patched.client;
    const p=await request(`/api/v4/clients/${S.client.id}/plan`,{weekStart:weekStart()});
    S.plan=p.plan; S.onboarding.step='topics';
  } finally { S.busy=''; render(); }
}
async function pollJob(clientId, projectId, jobId, label) {
  const started=Date.now();
  while(Date.now()-started<12*60*1000){
    const result=await request(`/api/clients/${clientId}/projects/${projectId}/jobs/${jobId}`);
    if(result.job.status==='succeeded') return true;
    if(['failed','cancelled'].includes(result.job.status)) throw new Error(result.job.error||`${label} failed`);
    await sleep(1100);
  }
  throw new Error(`${label} timed out`);
}
async function createProjectForItem(item, templateId) {
  const aspectRatio=item.type==='post'?'1:1':item.type==='story'?'9:16':'4:5';
  const payload={
    topic:item.angle,key:item.cardId,
    notes:`VERIFIED FACTS ONLY:\n- ${item.facts.join('\n- ')}\n\nDO NOT SAY:\n- ${item.avoid.join('\n- ')}`,
    language:'english',templateId,
    generation:{aspectRatio,provider:provider('image')[0],model:provider('image')[1],writingProvider:provider('writing')[0],writingModel:provider('writing')[1]}
  };
  return (await request(`/api/clients/${S.client.id}/projects`,payload)).project;
}
async function generateDraft(project) {
  const [writingProvider,writingModel]=provider('writing');
  const result=await request(`/api/clients/${S.client.id}/projects/${project.id}/jobs`,{stage:'draft',provider:writingProvider,model:writingModel,idempotencyKey:crypto.randomUUID()});
  await pollJob(S.client.id,project.id,result.job.id,'Copy generation');
  project=(await request(`/api/clients/${S.client.id}/projects/${project.id}`)).project;
  const slides=project.slides.map(s=>({...s,approved:true,approvedAt:new Date().toISOString()}));
  project=(await request(`/api/clients/${S.client.id}/projects/${project.id}`,{expectedRevision:project.revision,slides},'PATCH')).project;
  return project;
}
async function queueImages(project, indexes) {
  const [imageProvider,imageModel]=provider('image');
  const jobs=[];
  for(const slideIndex of indexes){
    const result=await request(`/api/clients/${S.client.id}/projects/${project.id}/jobs`,{stage:'image',provider:imageProvider,model:imageModel,slideIndex,idempotencyKey:crypto.randomUUID()});
    jobs.push({slideIndex,id:result.job.id});
  }
  return jobs;
}
async function refreshItemProject(item) {
  if(!item.projectId) return;
  try { item._project=(await request(`/api/clients/${S.client.id}/projects/${item.projectId}`)).project; } catch {}
}
async function patchPlanItem(item, extra) {
  const result=await request(`/api/v4/clients/${S.client.id}/plan`,{weekStart:S.plan.weekStart,itemId:item.id,...extra},'PATCH');
  S.plan=result.plan;
  return S.plan.items.find(x=>x.id===item.id);
}
async function buildItem(item, {hero=false}={}) {
  const styles=S.client.profile?.v4StyleIds||[];
  const idx=S.plan.items.findIndex(x=>x.id===item.id);
  const templateId=styles[idx%Math.max(styles.length,1)]||S.client.profile?.v4PrimaryStyleId;
  let project=await createProjectForItem(item,templateId);
  item=await patchPlanItem(item,{projectId:project.id,status:'generating'});
  project=await generateDraft(project);
  const indexes=item.type==='carousel'?[0,1,2,3,4]:[0];
  const jobs=await queueImages(project,indexes);
  if(hero && item.type==='carousel'){
    const first=jobs.find(x=>x.slideIndex===0);
    await pollJob(S.client.id,project.id,first.id,'First carousel slide');
    item=await patchPlanItem(item,{status:'ready'});
    await refreshItemProject(item);
    const rest=jobs.filter(x=>x.slideIndex!==0);
    Promise.all(rest.map(j=>pollJob(S.client.id,project.id,j.id,'Carousel slide')))
      .then(async()=>{const current=S.plan.items.find(x=>x.id===item.id); if(current){await refreshItemProject(current); render();}})
      .catch(e=>console.warn(e));
    return item;
  }
  await Promise.all(jobs.map(j=>pollJob(S.client.id,project.id,j.id,typeLabel(item.type))));
  item=await patchPlanItem(item,{status:'ready'});
  await refreshItemProject(item);
  return item;
}
async function buildRestOfWeek(excludeId) {
  const queue=(S.plan.items||[]).filter(x=>x.id!==excludeId&&!x.projectId);
  let cursor=0;
  const worker=async()=>{
    while(cursor<queue.length){
      const item=queue[cursor++];
      try{ await buildItem(item); }
      catch(e){ console.warn('Weekly item failed',item.id,e); const current=S.plan.items.find(x=>x.id===item.id); if(current) current.status='planned'; }
      render();
    }
  };
  await Promise.all([worker(),worker()]);
}
async function generateFirstWeek() {
  S.onboarding.step='generating'; S.generation={percent:10,label:'Planning your first carousel…'}; render();
  const hero=S.plan.items.find(x=>x.type==='carousel');
  try{
    S.generation={percent:24,label:'Writing from verified dental facts…'}; render();
    const result=await buildItem(hero,{hero:true});
    S.generation={percent:100,label:'Your first real result is ready'}; render();
    await refreshItemProject(result);
    S.selectedItem=result; S.view='review'; render();
    buildRestOfWeek(hero.id).catch(e=>console.warn(e));
  }catch(e){toast(e.message);S.onboarding.step='topics';S.view='onboarding';render();}
}
async function loadWeekProjects() {
  for(const item of S.plan?.items||[]) if(item.projectId) await refreshItemProject(item);
}
async function enterApp(client, plan) {
  S.client=client; S.plan=plan;
  if(!S.plan){const p=await request(`/api/v4/clients/${client.id}/plan`,{weekStart:weekStart()});S.plan=p.plan;}
  await loadWeekProjects();
  S.view='week'; render();
}
async function init() {
  try {
    const meRes=await fetch('/api/me');
    if(meRes.status===401){S.view='landing';render();return;}
    if(!meRes.ok) throw new Error('Could not start Srshti.');
    S.me=await meRes.json();
    const [boot,status]=await Promise.all([request('/api/v4/bootstrap'),request('/api/status')]);
    S.bootstrap=boot;S.status=status;S.clients=boot.clients||[];
    if(!S.clients.length){S.view='onboarding';S.onboarding.step='clinic';render();return;}
    S.client=S.clients[0];
    if(S.client.profile?.v4Onboarded){
      let plan=boot.latestPlan;
      if(!plan){plan=(await request(`/api/v4/clients/${S.client.id}/plan`,{weekStart:weekStart()})).plan;}
      await enterApp(S.client,plan);
    }else{S.view='onboarding';S.onboarding.step='clinic';render();}
  } catch(error){root.innerHTML=`<div class="v4-loading"><div class="notice error">${E(error.message)}</div></div>`;}
}

