import {estimate,money,calcDefaults} from './marketing.js';

// Film timeline. CSS keyframes inside a scene run while it has .play; these timed events
// drive the cursor and click states on the same pausable clock.
const scenes=[
 {dur:7600,nav:3,ev:[[2900,'move','[data-t=s1]'],[3500,'click','[data-t=s1]'],[5000,'move','[data-t=save]'],[5500,'click','[data-t=save]'],[5700,'add','.m-toast']]},
 {dur:6800,nav:0,ev:[[4300,'move','[data-t=approve]'],[4900,'click','[data-t=approve]']]},
 {dur:8600,nav:0,ev:[[3700,'move','[data-t=fix]'],[4300,'click','[data-t=fix]']]},
 {dur:8200,nav:0,ev:[[600,'text','[data-gen]','Designing slide 1 of 5'],[1500,'text','[data-gen]','Designing slide 2 of 5'],[2400,'text','[data-gen]','Designing slide 3 of 5'],[3300,'text','[data-gen]','Designing slide 4 of 5'],[4200,'text','[data-gen]','Designing slide 5 of 5'],[5200,'text','[data-gen]','✓ 5 slides ready'],[5200,'add','[data-gen]']]},
 {dur:8200,nav:2,ev:[[2600,'move','[data-t=ok]'],[3100,'click','[data-t=ok]'],[3900,'move','[data-t=dl]'],[4400,'click','[data-t=dl]']]}
];
// Credits shown in the sidebar after each scene's generation work (10 per image, 2 per draft).
const credits=[500,500,498,448,448];
let frame,cleanup=[];

export function mountDemo(){
 cleanup.forEach(fn=>fn());cleanup=[];
 document.documentElement.classList.add('m-js');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
 mountFilm(reduce);mountReveal(reduce);mountCalc();
}

function mountFilm(reduce){
 const film=document.querySelector('.m-film');if(!film)return;
 const stage=film.querySelector('.m-film-stage'),canvas=film.querySelector('.m-film-canvas'),cursor=film.querySelector('.m-cursor'),pause=film.querySelector('[data-m="film-pause"]'),bar=film.querySelector('.m-film-progress i');
 const chapters=[...document.querySelectorAll('[data-m="chapter"]')],sections=[...film.querySelectorAll('.m-sc')];
 let scene=0,elapsed=0,last=0,fired=0,paused=reduce,visible=true;
 const fit=()=>{const w=stage.clientWidth;film.classList.toggle('compact',w<640);film.style.setProperty('--k',String(w/(w<640?600:1000)))};
 const pointAt=selector=>{const target=sections[scene].querySelector(selector);if(!target)return;const k=Number(getComputedStyle(film).getPropertyValue('--k'))||1,c=canvas.getBoundingClientRect(),r=target.getBoundingClientRect();cursor.style.transform=`translate(${(r.left-c.left+r.width*.62)/k}px,${(r.top-c.top+r.height*.55)/k}px)`;cursor.classList.add('show')};
 const run=([,type,selector,value])=>{const el=sections[scene].querySelector(selector);if(type==='move')pointAt(selector);if(type==='click'){cursor.classList.remove('tap');void cursor.offsetWidth;cursor.classList.add('tap');el?.classList.add('done')}if(type==='add')el?.classList.add('done');if(type==='text'&&el)el.textContent=value};
 const enter=(i,{finish=false}={})=>{
  scene=i;elapsed=0;fired=0;film.dataset.scene=i;
  sections.forEach((s,j)=>{s.classList.toggle('on',j===i);s.classList.remove('play');s.querySelectorAll('.done').forEach(el=>el.classList.remove('done'))});
  const gen=sections[3].querySelector('[data-gen]');if(gen)gen.textContent='Designing slide 1 of 5';
  void sections[i].offsetWidth;sections[i].classList.add('play');
  film.querySelectorAll('[data-nav]').forEach(n=>n.classList.toggle('on',Number(n.dataset.nav)===scenes[i].nav));
  film.querySelector('[data-credits]').textContent=credits[i];
  cursor.classList.remove('show','tap');cursor.style.transform='translate(820px,560px)';
  chapters.forEach((c,j)=>{c.setAttribute('aria-pressed',String(j===i));c.querySelector('i').style.setProperty('--p',j<i?1:0)});
  if(finish){scenes[i].ev.forEach(e=>{if(e[1]!=='move')run(e)});cursor.classList.remove('show','tap');film.classList.add('static')}else film.classList.remove('static');
 };
 const total=scenes.reduce((a,s)=>a+s.dur,0);
 const tick=now=>{
  frame=requestAnimationFrame(tick);
  const dt=Math.min(64,now-(last||now));last=now;
  if(paused||!visible||document.hidden)return;
  elapsed+=dt;const ev=scenes[scene].ev;
  while(fired<ev.length&&ev[fired][0]<=elapsed)run(ev[fired++]);
  const p=Math.min(1,elapsed/scenes[scene].dur);chapters[scene]?.querySelector('i').style.setProperty('--p',p);
  bar.style.transform=`scaleX(${(scenes.slice(0,scene).reduce((a,s)=>a+s.dur,0)+elapsed)/total})`;
  if(elapsed>=scenes[scene].dur)enter((scene+1)%scenes.length);
 };
 const setPaused=value=>{paused=value;film.classList.toggle('paused',paused);pause.innerHTML=`<span aria-hidden="true">${paused?'▶':'❚❚'}</span>`;pause.setAttribute('aria-label',paused?'Play animation':'Pause animation')};
 const onClick=event=>{
  const el=event.target.closest('[data-m]');if(!el)return;
  if(el.dataset.m==='film-pause'){setPaused(!paused);if(!paused&&film.classList.contains('static'))enter(scene)}
  if(el.dataset.m==='chapter'){const i=Number(el.dataset.step);enter(i,{finish:reduce});if(!reduce)setPaused(false)}
 };
 const root=document.querySelector('.marketing');root.addEventListener('click',onClick);
 const ro=new ResizeObserver(fit);ro.observe(stage);fit();
 const io=new IntersectionObserver(([e])=>{visible=e.isIntersecting},{threshold:.15});io.observe(film);
 setPaused(paused);enter(0,{finish:reduce});
 cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);
 cleanup.push(()=>{cancelAnimationFrame(frame);ro.disconnect();io.disconnect();root.removeEventListener('click',onClick)});
}

function mountReveal(reduce){
 const items=[...document.querySelectorAll('.rv')];
 if(reduce||!('IntersectionObserver' in window)){items.forEach(el=>el.classList.add('in'));return}
 const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
 items.forEach(el=>io.observe(el));cleanup.push(()=>io.disconnect());
 const root=document.querySelector('.marketing');
 const onClick=event=>{
  const el=event.target.closest('[data-m]');if(!el)return;
  if(el.dataset.m==='theme'){const show=document.querySelector('[data-showcase]');show.classList.remove('th-teal','th-lav','th-ivory');show.classList.add(`th-${el.dataset.theme}`);el.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===el)))}
  if(el.dataset.m==='region'){const r=el.dataset.region;document.querySelectorAll('.m-seals article').forEach(a=>a.hidden=r!=='all'&&a.dataset.region!==r);el.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===el)))}
 };
 root?.addEventListener('click',onClick);cleanup.push(()=>root?.removeEventListener('click',onClick));
}

function mountCalc(){
 const box=document.querySelector('.m-calc');if(!box)return;
 const out=key=>box.querySelector(`[data-out="${key}"]`);
 const shown={saving:null,designer:null};
 const count=(key,to)=>{const el=out(key),from=shown[key]??to;shown[key]=to;if(matchMedia('(prefers-reduced-motion: reduce)').matches||from===to){el.textContent=money(to);return}const t0=performance.now();const step=now=>{const p=Math.min(1,(now-t0)/450),e=1-Math.pow(1-p,3);el.textContent=money(from+(to-from)*e);if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
 const update=()=>{
  const v={...calcDefaults};box.querySelectorAll('[data-calc]').forEach(i=>{v[i.dataset.calc]=Number(i.value);out(i.dataset.calc).textContent=(i.dataset.calc==='rate'?'$':'')+i.value;i.style.setProperty('--fill',`${(i.value-i.min)/(i.max-i.min)*100}%`)});
  const r=estimate(v);
  out('hours').textContent=`${r.hours.toLocaleString('en-US')} hours of design time`;
  count('designer',r.designer);
  out('plan').textContent=r.plan?r.plan.name:'Custom';
  out('credits').textContent=r.plan?`${r.credits} of ${r.plan.credits} credits`:`${r.credits} credits: more than our largest plan`;
  out('price').textContent=r.plan?money(r.plan.price):'Let’s talk';
  const max=Math.max(r.designer,r.plan?.price||0,1);
  box.querySelector('[data-bar="designer"]').style.setProperty('--w',`${Math.max(3,r.designer/max*100)}%`);
  box.querySelector('[data-bar="srshti"]').style.setProperty('--w',r.plan?`${Math.max(3,r.plan.price/max*100)}%`:'100%');
  const save=box.querySelector('.m-save');save.classList.toggle('none',!r.plan||!r.saving);
  if(r.plan){count('saving',r.saving);out('year').textContent=money(r.saving*12)}else{out('saving').textContent='Custom plan';out('year').textContent='contact us';shown.saving=null}
 };
 box.addEventListener('input',update);update();cleanup.push(()=>box.removeEventListener('input',update));
}

export function handleMarketingAction(name,el){if(name==='section'){const target=document.getElementById(el.dataset.target);if(target)target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});else location.href=el.href}}
