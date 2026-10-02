document.addEventListener('submit',async event=>{
  if(event.target.id!=='clinic-form')return;
  event.preventDefault();
  const data=new FormData(event.target);
  S.onboarding.website=String(data.get('website')||'');S.onboarding.instagram=String(data.get('instagram')||'');
  S.onboarding.step='quick';render();
  S.onboarding.analysisPromise=request('/api/v4/analyze-clinic',{website:S.onboarding.website,instagram:S.onboarding.instagram})
    .then(r=>(S.onboarding.analysis=r.analysis,r.analysis));
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if(!button)return;
  const action=button.dataset.action,value=button.dataset.value,id=button.dataset.id;
  try{
    if(action==='goal'){S.onboarding.goal=value;render();}
    if(action==='frequency'){S.onboarding.frequency=Number(value);render();}
    if(action==='finish-quick'){
      button.disabled=true;
      try{S.onboarding.analysis=await S.onboarding.analysisPromise;}
      catch(e){toast(e.message);S.onboarding.analysis={website:S.onboarding.website,instagram:S.onboarding.instagram,name:'My Dental Clinic',services:['General dentistry'],primary:'#5b5bd6',accent:'#14b8a6'};}
      S.onboarding.step='analysis';render();
    }
    if(action==='create-clinic'){
      const a=S.onboarding.analysis;
      a.name=document.querySelector('#confirm-name').value.trim()||a.name;
      a.location=document.querySelector('#confirm-location').value.trim();
      a.phone=document.querySelector('#confirm-phone').value.trim();
      a.primary=document.querySelector('#confirm-primary').value;
      S.busy='create-clinic';button.disabled=true;
      await saveAnalysisAsClient();S.onboarding.step='styles';S.onboarding.styleBatch=0;render();await generateStylesBatch();
      S.busy='';
    }
    if(action==='select-style'){S.onboarding.primaryIndex=Number(value);render();}
    if(action==='more-styles'){S.onboarding.styleBatch=(S.onboarding.styleBatch+1)%Math.ceil(designCatalog.length/3);S.busy='styles';await generateStylesBatch();S.busy='';render();}
    if(action==='save-styles') await saveStyles();
    if(action==='replace-topic'){
      const result=await request(`/api/v4/clients/${S.client.id}/plan/replace`,{weekStart:S.plan.weekStart,itemId:id});
      S.plan=result.plan;render();
    }
    if(action==='approve-topic'){toast('Kept for Week 1');}
    if(action==='generate-week'){await generateFirstWeek();}
    if(action==='filter'){S.filter=value;render();}
    if(action==='review-item'){
      const item=S.plan.items.find(x=>x.id===id);
      if(!item.projectId){toast('This item is still being prepared.');return;}
      await refreshItemProject(item);S.selectedItem=item;S.view='review';render();
    }
    if(action==='approve-item'){
      const item=S.plan.items.find(x=>x.id===id);
      await patchPlanItem(item,{approved:true,status:'ready'});await loadWeekProjects();S.view='week';render();toast('Approved');
    }
    if(action==='replace-item'){
      const result=await request(`/api/v4/clients/${S.client.id}/plan/replace`,{weekStart:S.plan.weekStart,itemId:id});
      S.plan=result.plan;S.view='week';render();toast('Fresh idea added');
    }
    if(action==='edit-project'){
      const item=S.plan.items.find(x=>x.id===id);const p=item._project;if(!p)return;
      const slide=p.slides?.[0];
      const heading=prompt('Edit the first slide headline',slide?.heading||'');
      if(heading===null)return;
      const slides=p.slides.map((s,i)=>i===0?{...s,heading}:s);
      item._project=(await request(`/api/clients/${S.client.id}/projects/${p.id}`,{expectedRevision:p.revision,slides},'PATCH')).project;
      render();toast('Saved. Regenerate the changed slide from the project if needed.');
    }
    if(action==='back-week'){S.view='week';render();}
    if(action==='nav'){
      if(value==='week'||value==='home'){S.view='week';render();}
      else if(value==='calendar'){S.view='calendar';render();}
      else if(value==='brand'){S.view='brand';render();}
      else toast('This section is ready for the next V4 iteration.');
    }
    if(action==='regenerate-plan'){
      const result=await request(`/api/v4/clients/${S.client.id}/plan`,{weekStart:S.plan.weekStart,regenerate:true});
      S.plan=result.plan;render();toast('Fresh week ideas created');
    }
    if(action==='logout'){await request('/api/auth/logout',{},'POST');location.reload();}
  }catch(error){S.busy='';toast(error.message);render();}
});

init();
