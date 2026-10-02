import {api} from '../api.js';
import {esc,attr,title,thumb,status,typeLabel,retryJobs} from '../ui.js';
import {go,toast} from '../app.js';

export function itemCard(item,working=false,showControls=true){
 const ready=item.frames.length>0&&item.frames.every(f=>f.assetId),skipped=item.status==='skipped';
 const facts=(item.brief?.facts||[]).slice(0,3);
 const itemWorking=['briefing','writing','validating','generating'].includes(item.status),canGenerate=!skipped&&!ready&&item.frames.length>0&&['validated','approved'].includes(item.copy_status);
 const artworkControl=showControls&&item.week_id&&canGenerate?`<button class="btn primary small full spaced" data-action="generate-item" data-id="${item.id}" ${itemWorking?'disabled aria-busy="true"':''}>${itemWorking?'Creating artwork…':'▶ Create remaining artwork'}</button>`:'';
 return `<article class="content-card ${skipped?'is-skipped':''}"><a class="content-art ${item.type}" href="#/review?id=${item.id}" aria-label="Review ${attr(item.topic)}">${thumb(item)}<span class="art-type">${esc(typeLabel(item))}</span></a><div class="content-info"><div class="card-status">${status(item)}<small>${item.angle?esc(item.angle):'Knowledge base selection'}</small></div><h3>${esc(item.brief?.sourceTopic||item.topic||'Your content')}</h3><p>${esc(item.brief?.sourceSummary||facts[0]||item.brief?.summary||'Review this source topic before preparing its brief.')}</p>${facts.length?`<details><summary>Knowledge base facts (${item.brief.facts.length})</summary>${facts.map(f=>`<p class="small-copy">${esc(f)}</p>`).join('')}</details>`:''}<a class="btn ${ready?'primary':''} small full" href="#/review?id=${item.id}">${ready?'Review artwork →':item.frames.length?'Review copy →':item.brief?.prepared?'Prepare content →':'Review topic →'}</a>${artworkControl}${showControls&&item.week_id?`<button class="btn small full spaced" data-action="change-topic" data-id="${item.id}" ${working?'disabled':''}>Change topic ↻</button><div class="two-col spaced"><button class="btn small" data-action="restart-item" data-id="${item.id}" data-stage="${!item.brief?.prepared?'brief':item.copy_status==='rejected'||!item.frames.length?'writing':'images'}" ${working?'disabled':''}>Restart</button>${skipped?'<span></span>':`<button class="btn small" data-action="skip-item" data-id="${item.id}">Skip</button>`}</div>`:''}</div></article>`
}
export async function render(state){
 const c=state.clinic,create='<a class="btn" href="#/create">Create content +</a>';
 if(!c)return `<div class="empty-state"><h1>Let’s set up your clinic.</h1><a class="btn primary" href="#/setup">Set up my clinic →</a></div>`;
 if(c.status!=='active')return `${title('YOUR FIRST WEEK','Your clinic comes first.','Confirm your details and choose a style.')}<a class="btn primary" href="#/setup?step=profile">Continue setup →</a>`;
 if(!state.week)return `${title('YOUR CONTENT PLAN','Choose your topics first.','Review the knowledge base topics before preparing content.',create)}<div class="panel empty-state"><h2>Your brand is ready.</h2><button class="btn primary" data-action="plan-week">Plan this week →</button><a class="btn spaced" href="#/create">Create a standalone piece</a></div>`;
 const week=state.week,allItems=week.items,items=allItems.filter(i=>state.filter==='all'||i.type===state.filter),working=week.jobs.some(j=>['queued','running'].includes(j.status)),active=allItems.filter(i=>i.status!=='skipped'),allReady=active.length>0&&week.ready===active.length;
 const hasBriefs=active.every(i=>Boolean(i.brief?.prepared)),hasCopy=active.every(i=>i.copy_status==='validated'||i.copy_status==='approved'),hasImages=allReady;
 const mode=state.weekMode||'step',validated=allItems.filter(i=>['validated','approved'].includes(i.copy_status)).length,copyApproved=allItems.filter(i=>i.copy_status==='approved').length;
 let nextLabel='Approve topics & prepare content',nextStage='brief',message='Review the selected knowledge base topics and facts below. Approving automatically prepares briefs and writes the content.';
 if(mode==='all'){nextLabel='Run full week';nextStage='all';message='Runs briefs, copy writing and artwork in order. You can stop the week at any time.';}
 else if(hasBriefs&&!hasCopy){nextLabel='Prepare content';nextStage='writing';message='Continue preparing content from your selected topics.';}
 else if(hasCopy&&!hasImages){nextLabel='Create all images';nextStage='images';message='Copy is ready. Use the play button on an item to create its artwork, or create all images together.';}
 else if(hasImages){nextLabel='Artwork ready';message='Review each item, approve the week and download your content pack.';}
 return `${title('YOUR CONTENT, YOUR WAY','Your week, step by step.',`Week of ${week.week_start} · ${c.name} · ${c.profile.language||'English'}`,`${create}<button class="btn" data-action="clear-week">Remove all content</button><button class="btn" data-action="next-week">Plan next week</button>${working?'<button class="btn" data-action="cancel-week">Stop week</button>':''}`)}<div class="week-stats"><div><span>Selected topics</span><b>${active.length} / ${week.itemCount||allItems.length}</b></div><div><span>Briefs ready</span><b>${active.filter(i=>i.brief?.prepared).length} / ${active.length}</b></div><div><span>Copy validated</span><b>${validated} / ${active.length}</b></div><div><span>Artwork ready</span><b>${week.ready} / ${active.length}</b></div></div>${retryJobs(week.jobs)}<div class="panel plan-footer"><div><h3>${working?'Your week is in progress.':hasImages?'Your artwork is ready to review.':hasCopy?'Validated copy is ready for artwork.':hasBriefs?'Your topics are ready for content preparation.':'Review this week’s source topics.'}</h3><p>${working?'Stop the week to pause unfinished work. Completed pieces stay available.':message}</p></div><div class="heading-actions"><label class="field inline-field">Workflow<select data-change="week-mode"><option value="step" ${mode==='step'?'selected':''}>Step by step</option><option value="all" ${mode==='all'?'selected':''}>Run from start to finish</option></select></label>${hasImages?`<button class="btn primary" data-action="approve-week" ${week.status==='approved'?'disabled':''}>${week.status==='approved'?'✓ Week approved':'Approve artwork'}</button><button class="btn" data-action="download-week">Download pack ↓</button>`:`<button class="btn primary" data-action="run-week" data-stage="${nextStage}" ${working||hasImages?'disabled':''}>${week.status==='cancelled'?'Resume · ':''}${nextLabel} →</button>`}</div></div><div class="section-head"><div class="tabs" role="group" aria-label="Content format">${[['all','All content'],['carousel','Carousels'],['post','Posts'],['story','Stories']].map(([v,label])=>`<button class="${state.filter===v?'active':''}" data-action="filter" data-filter="${v}">${label} <span>${v==='all'?active.length:active.filter(i=>i.type===v).length}</span></button>`).join('')}</div></div><div class="content-grid">${items.map(i=>itemCard(i,working)).join('')}</div>`;
}
export async function change(name,el,state){if(name==='week-mode'){state.weekMode=el.value;go('/week');}}
export async function action(name,el,state){
 if(name==='filter'){state.filter=el.dataset.filter;go('/week');return;}
 if(name==='clear-week'){
  if(!window.confirm('Remove all content from this week? Running tasks will stop, and this week’s drafts and artwork will be removed from your library.'))return;
  await api(`/weeks/${state.week.id}`,{method:'DELETE'});
  state.planWeekStart=state.week.week_start;state.week=null;state.reviewItem=null;state.contentJobs=[];state.filter='all';
  toast('All content removed. You can plan this week again.');go('/week');return;
 }
 if(name==='change-topic'){
  const item=state.week.items.find(i=>i.id===el.dataset.id);
  if(item?.frames.length&&!window.confirm('Change this topic? Its existing copy and artwork will be replaced with a new topic suggestion.'))return;
  await api(`/content/${el.dataset.id}/replace`,{method:'POST',body:{}});
  state.week=(await api(`/weeks/${state.week.id}`)).week;
  toast('New topic selected. Review it before preparing content.');go('/week');return;
 }
 if(name==='plan-week'){state.week=(await api(`/clinics/${state.clinic.id}/weeks`,{method:'POST',body:state.planWeekStart?{weekStart:state.planWeekStart}:{}})).week;state.planWeekStart=null;go('/week');return;}
 if(name==='next-week'){const date=new Date(`${state.week.week_start}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+7);state.week=(await api(`/clinics/${state.clinic.id}/weeks`,{method:'POST',body:{weekStart:date.toISOString()}})).week;go('/week');return;}
 if(name==='download-week'){const {downloadPack}=await import('../export.js');await downloadPack(state.week.items.filter(i=>i.status!=='skipped'),state.clinic,state.week.week_start);toast('Your artwork and captions are ready.');return;}
 if(name==='generate-item'){
  await api(`/content/${el.dataset.id}/generate`,{method:'POST',body:{}});
  state.week=(await api(`/weeks/${state.week.id}`)).week;
  toast('Creating remaining artwork for this item.');go('/week');return;
 }
 if(name==='skip-item'||name==='restart-item'){
  const path=name==='skip-item'?'skip':'restart',body=name==='restart-item'?{stage:el.dataset.stage}:{};
  await api(`/content/${el.dataset.id}/${path}`,{method:'POST',body});state.week=(await api(`/weeks/${state.week.id}`)).week;go('/week');return;
 }
 const endpoint={'cancel-week':'cancel','approve-week':'approve'}[name];
 if(endpoint){state.week=(await api(`/weeks/${state.week.id}/${endpoint}`,{method:'POST',body:{}})).week;go('/week');return;}
 if(name==='run-week'){state.week=(await api(`/weeks/${state.week.id}/generate`,{method:'POST',body:{stage:el.dataset.stage}})).week;go('/week');}
}
