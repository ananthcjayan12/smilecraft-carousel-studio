import {supportEmail,plans} from './marketing.js';
const form=document.querySelector('#contact-form');
if(form){const plan=plans.find(p=>p.id===new URLSearchParams(location.search).get('plan'));if(plan)form.elements.message.value=`I'd like to enquire about ${plan.name} at $${plan.price} USD per month.`;form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);const subject=`Srshti: ${data.get('topic')}`;const body=`Reply email: ${data.get('email')}\n\n${data.get('message')}`;location.href=`mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;document.querySelector('#contact-status').textContent='Email draft requested. If your email app did not open, email us directly using the address above.'})}
const checklist=document.querySelector('#marketing-checklist');checklist?.addEventListener('change',()=>{const count=checklist.querySelectorAll('input:checked').length;checklist.querySelector('[role="status"]').textContent=`${count} of 6 review reminders checked.${count===6?' Reminder complete; your clinic must still verify compliance.':''}`});
document.querySelector('#clear-preferences')?.addEventListener('click',()=>{try{localStorage.removeItem('srshti-clinic');document.querySelector('#cookie-status').textContent='Remembered clinic cleared. Your workspace data is unchanged.'}catch{document.querySelector('#cookie-status').textContent='Your browser prevented access to local preferences.'}});

import {marketingConfig} from './marketing-config.js';
import {validatedCalendarUrl,confirmedBooking} from './demo-tracking.js';
const consentKey='srshti-ad-measurement';
let measurementAllowed=false, pixelReady=false;
function savedChoice(){try{return localStorage.getItem(consentKey)}catch{return null}}
function loadPixel(){
 if(!marketingConfig.pixelId||pixelReady)return;
 pixelReady=true;
 window.oaiq=window.oaiq||function(){(window.oaiq.q=window.oaiq.q||[]).push(arguments)};
 window.oaiq('consent',true);
 window.oaiq('init',{pixelId:marketingConfig.pixelId});
 const script=document.createElement('script');script.async=true;script.src='https://bzrcdn.openai.com/sdk/oaiq.min.js';document.head.append(script);
 window.oaiq('measure','page_viewed',{type:'contents'});
}
function chooseMeasurement(choice){
 measurementAllowed=choice==='allow';
 try{localStorage.setItem(consentKey,choice)}catch{}
 if(measurementAllowed)loadPixel();else window.oaiq?.('consent',false);
 document.querySelector('#measurement-banner')?.remove();
 const status=document.querySelector('#measurement-status');if(status)status.textContent=marketingConfig.pixelId?`Advertising measurement ${measurementAllowed?'allowed':'rejected'}.`:'No advertising pixel is configured. Your preference is saved.';
}
export function mountMeasurement(){
 if(!marketingConfig.pixelId)return;
 const choice=savedChoice();measurementAllowed=choice==='allow';
 if(measurementAllowed)loadPixel();
 if(choice||document.querySelector('#measurement-banner'))return;
 const banner=document.createElement('aside');banner.id='measurement-banner';banner.className='m-measurement';banner.setAttribute('aria-label','Optional advertising measurement');
 banner.innerHTML='<b>Your choice about advertising measurement</b><p>Allow the OpenAI Ads pixel to measure visits and confirmed demo bookings, or reject it. You can request a demo either way. <a href="/cookies/">Cookie details</a></p><div class="m-actions"><button type="button" class="btn primary" data-measurement="allow">Allow measurement</button><button type="button" class="btn" data-measurement="reject">Reject measurement</button></div>';
 document.body.append(banner);
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-measurement]');if(button)chooseMeasurement(button.dataset.measurement)});
window.addEventListener('storage',event=>{if(event.key===consentKey){measurementAllowed=event.newValue==='allow';if(measurementAllowed)loadPixel();else window.oaiq?.('consent',false)}});
mountMeasurement();
const sampleForm=document.querySelector('#sample-request-form');
if(sampleForm)sampleForm.addEventListener('submit',async event=>{
 event.preventDefault();
 const status=document.querySelector('#sample-request-status'),button=sampleForm.querySelector('button[type=submit]'),field=sampleForm.elements;
 const instagram=field.instagram.value.trim();
 field.instagram.setCustomValidity(/^(@?[A-Za-z0-9._]{1,30}|(https?:\/\/)?(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?.*)$/i.test(instagram)?'':'Enter your clinic’s Instagram handle, for example @yourclinic.');
 if(!sampleForm.reportValidity())return;
 const utm=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content'].map(k=>[k,new URLSearchParams(location.search).get(k)||'']));
 button.disabled=true;button.textContent='Sending…';status.textContent='';status.classList.remove('error');
 try{
  const response=await fetch('/api/public/sample-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:field.name.value,clinic:field.clinic.value,email:field.email.value,instagram,company:field.company.value,utm})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'We could not save your request. Please try again.');
  sampleForm.hidden=true;const done=document.querySelector('#sample-request-done');done.hidden=false;done.focus?.();
 }catch(error){status.textContent=error.message;status.classList.add('error');button.disabled=false;button.textContent='Request my free carousel'}
});
sampleForm?.addEventListener('input',()=>sampleForm.elements.instagram.setCustomValidity(''));
const calendarUrl=validatedCalendarUrl(marketingConfig.bookingUrl);
if(calendarUrl&&document.querySelector('#calendar-booking')){
 document.querySelector('#calendar-booking').hidden=false;
 document.querySelector('#calendar-fallback')?.remove();
 const utm=new URLSearchParams(location.search);for(const key of ['utm_source','utm_medium','utm_campaign','utm_content'])if(utm.has(key))calendarUrl.searchParams.set(key,utm.get(key).slice(0,200));
 document.querySelector('#calendar-link').href=calendarUrl.href;
 const embedded=new URL(calendarUrl);embedded.searchParams.set('embed_domain',location.hostname);embedded.searchParams.set('embed_type','Inline');embedded.searchParams.set('hide_gdpr_banner','1');
 const frame=document.createElement('iframe');frame.src=embedded.href;frame.title='Book a 15-minute Srshti dental content demo';frame.referrerPolicy='strict-origin-when-cross-origin';document.querySelector('#calendar-embed').append(frame);
 const seen=new Set();
 window.addEventListener('message',event=>{
  const uri=confirmedBooking(event,frame.contentWindow);if(!uri||seen.has(uri))return;seen.add(uri);
  document.querySelector('#booking-status').textContent='Your demo is booked. Check your email for the confirmation and joining details.';
  if(measurementAllowed&&marketingConfig.pixelId){loadPixel();window.oaiq('measure','appointment_scheduled',{type:'customer_action'},{event_id:uri});}
 });
}
const track=document.querySelector('.m-sp-track');
if(track){
 const beats=[...document.querySelectorAll('[data-slide]')],dots=[...document.querySelectorAll('.m-sp-dots i')];
 const show=i=>{beats.forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));dots.forEach((d,j)=>d.classList.toggle('on',i===j))};
 beats.forEach(b=>b.addEventListener('click',()=>track.scrollTo({left:track.clientWidth*Number(b.dataset.slide),behavior:'smooth'})));
 track.addEventListener('scroll',()=>show(Math.round(track.scrollLeft/track.clientWidth)),{passive:true});
}
const lightboxLinks=[...document.querySelectorAll('[data-lightbox]')];
if(lightboxLinks.length&&window.HTMLDialogElement){
 const box=document.createElement('dialog');box.className='m-lightbox';box.setAttribute('aria-label','Image viewer');
 box.innerHTML='<img alt=""><button type="button" class="m-lb-prev" aria-label="Previous image">‹</button><button type="button" class="m-lb-next" aria-label="Next image">›</button><button type="button" class="m-lb-close" aria-label="Close">✕</button>';
 document.body.append(box);
 const img=box.querySelector('img');let group=[],at=0;
 const open=i=>{at=(i+group.length)%group.length;const link=group[at];img.src=link.href;img.alt=link.querySelector('img')?.alt||'';box.querySelectorAll('.m-lb-prev,.m-lb-next').forEach(b=>b.hidden=group.length<2)};
 lightboxLinks.forEach(link=>link.addEventListener('click',event=>{event.preventDefault();group=lightboxLinks.filter(l=>l.dataset.lightbox===link.dataset.lightbox);open(group.indexOf(link));box.showModal()}));
 box.querySelector('.m-lb-prev').addEventListener('click',()=>open(at-1));box.querySelector('.m-lb-next').addEventListener('click',()=>open(at+1));box.querySelector('.m-lb-close').addEventListener('click',()=>box.close());
 box.addEventListener('click',event=>{if(event.target===box)box.close()});
 box.addEventListener('keydown',event=>{if(event.key==='ArrowLeft')open(at-1);if(event.key==='ArrowRight')open(at+1)});
}
