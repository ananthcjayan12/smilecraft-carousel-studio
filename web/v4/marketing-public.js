import {supportEmail,plans} from './marketing.js';
const form=document.querySelector('#contact-form');
if(form){const plan=plans.find(p=>p.id===new URLSearchParams(location.search).get('plan'));if(plan)form.elements.message.value=`I'd like to enquire about ${plan.name} at $${plan.price} USD per month.`;form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;const data=new FormData(form);const subject=`Srshti: ${data.get('topic')}`;const body=`Reply email: ${data.get('email')}\n\n${data.get('message')}`;location.href=`mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;document.querySelector('#contact-status').textContent='Email draft requested. If your email app did not open, email us directly using the address above.'})}
const checklist=document.querySelector('#marketing-checklist');checklist?.addEventListener('change',()=>{const count=checklist.querySelectorAll('input:checked').length;checklist.querySelector('[role="status"]').textContent=`${count} of 6 review reminders checked.${count===6?' Reminder complete; your clinic must still verify compliance.':''}`});
document.querySelector('#clear-preferences')?.addEventListener('click',()=>{try{localStorage.removeItem('srshti-clinic');document.querySelector('#cookie-status').textContent='Remembered clinic cleared. Your workspace data is unchanged.'}catch{document.querySelector('#cookie-status').textContent='Your browser prevented access to local preferences.'}});

import {marketingConfig} from './marketing-config.js';
import {validatedCalendarUrl,confirmedBooking} from './demo-tracking.js';
import {sampleForm,sampleUrl} from './sample-offer.js';
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
// Conversions go to the pixel only with consent. event_id lets OpenAI drop duplicates of the same booking or request.
function measure(name,eventId){if(!measurementAllowed||!marketingConfig.pixelId)return;loadPixel();window.oaiq('measure',name,{type:'customer_action'},{event_id:eventId})}
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
 banner.innerHTML='<b>Your choice about advertising measurement</b><p>Allow the OpenAI Ads pixel to measure visits, free sample requests and confirmed demo bookings, or reject it. You can request a sample or a demo either way. <a href="/cookies/">Cookie details</a></p><div class="m-actions"><button type="button" class="btn primary" data-measurement="allow">Allow measurement</button><button type="button" class="btn" data-measurement="reject">Reject measurement</button></div>';
 document.body.append(banner);
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-measurement]');if(button)chooseMeasurement(button.dataset.measurement)});
window.addEventListener('storage',event=>{if(event.key===consentKey){measurementAllowed=event.newValue==='allow';if(measurementAllowed)loadPixel();else window.oaiq?.('consent',false)}});
mountMeasurement();
// Free sample carousel: the same form runs inline on /free-carousel/ and in a pop-up opened by any [data-sample-open] link.
const sampleFields=['name','clinic','email','instagram'],sentKey='srshti-sample-sent',utmKey='srshti-utm';
const utmKeys=['utm_source','utm_medium','utm_campaign','utm_content'];
// Keep the ad's campaign tags for the visit, so a request made after browsing other pages is still attributed.
const pageUtm=Object.fromEntries(utmKeys.map(k=>[k,new URLSearchParams(location.search).get(k)||'']));
if(Object.values(pageUtm).some(Boolean))try{sessionStorage.setItem(utmKey,JSON.stringify(pageUtm))}catch{}
function campaignTags(){if(Object.values(pageUtm).some(Boolean))return pageUtm;try{return {...pageUtm,...JSON.parse(sessionStorage.getItem(utmKey)||'{}')}}catch{return pageUtm}}
function sampleError(form,name){
 const value=form.elements[name].value.trim();
 if(name==='instagram')return !value?'Your clinic’s Instagram is required so we can match your branding.':/^(@?[A-Za-z0-9._]{1,30}|(https?:\/\/)?(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?(\?.*)?)$/i.test(value)?'':'Enter a valid Instagram handle, for example @yourclinic.';
 if(!value)return {name:'Please enter your name.',clinic:'Please enter your clinic name.',email:'Please enter your email.'}[name];
 return name==='email'&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(value)?'Enter a valid email, for example you@yourclinic.com.':'';
}
function showSampleError(form,name,message){const input=form.elements[name],box=form.querySelector(`#${input.id}-error`);input.setAttribute('aria-invalid',String(Boolean(message)));box.textContent=message;box.hidden=!message}
const sampleTarget=event=>{const form=event.target.form;return form?.matches('[data-sample-form]')&&sampleFields.includes(event.target.name)?form:null};
// Check a field when the visitor leaves it (not while they tab past an empty one), and clear its error as soon as it is fixed.
document.addEventListener('focusout',event=>{const form=sampleTarget(event);if(form&&event.target.value.trim())showSampleError(form,event.target.name,sampleError(form,event.target.name))});
document.addEventListener('input',event=>{const form=sampleTarget(event);if(form&&event.target.getAttribute('aria-invalid')==='true')showSampleError(form,event.target.name,sampleError(form,event.target.name))});
document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.matches?.('[data-sample-form]'))return;
 event.preventDefault();
 const errors=sampleFields.map(name=>[name,sampleError(form,name)]);errors.forEach(([name,message])=>showSampleError(form,name,message));
 const invalid=errors.find(([,message])=>message);if(invalid)return form.elements[invalid[0]].focus();
 const status=form.querySelector('[data-sample-status]'),button=form.querySelector('button[type=submit]'),label=button.textContent,field=form.elements;
 button.disabled=true;button.textContent='Sending…';status.textContent='';status.classList.remove('error');
 try{
  const response=await fetch('/api/public/sample-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:field.name.value,clinic:field.clinic.value,email:field.email.value,instagram:field.instagram.value.trim(),company:field.company.value,utm:campaignTags()})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'We could not save your request. Please try again.');
  if(response.status===201&&result.id)measure('lead_created',result.id); // the honeypot reply is 200 without an id
  try{localStorage.setItem(sentKey,'1')}catch{}
  document.querySelector('.m-sample-fab')?.remove();
  form.hidden=true;const done=form.parentElement.querySelector('[data-sample-done]');done.hidden=false;done.focus();
 }catch(error){status.textContent=error.message;status.classList.add('error');button.disabled=false;button.textContent=label}
});
let sampleDialog;
function sampleModal(){
 if(sampleDialog)return sampleDialog;
 sampleDialog=document.createElement('dialog');sampleDialog.className='m-sample-modal';sampleDialog.setAttribute('aria-labelledby','sm-title');
 const art=['carousel-01','carousel-03','carousel-05'].map(f=>`<img src="/assets/demo/harbour-gum/${f}.webp" alt="" width="1080" height="1350" decoding="async">`).join('');
 sampleDialog.innerHTML=`<div class="m-sm-in"><button type="button" class="m-sm-close" aria-label="Close">✕</button><aside class="m-sm-visual"><span class="m-sm-pill">FREE · NO OBLIGATION</span><h2>Your clinic, <em>in a carousel.</em></h2><div class="m-sm-fan" aria-hidden="true">${art}</div><ul><li>Five slides and a caption in your branding</li><li>Emailed to you within 12 hours</li><li>No passwords, card or patient data</li></ul><small>Example shown: Harbour Gum Dental, a fictional clinic.</small></aside><div class="m-sm-body">${sampleForm('sm')}</div></div>`;
 document.body.append(sampleDialog);
 sampleDialog.querySelector('.m-sm-close').addEventListener('click',()=>sampleDialog.close());
 sampleDialog.addEventListener('click',event=>{if(event.target===sampleDialog)sampleDialog.close()});
 return sampleDialog;
}
document.addEventListener('click',event=>{
 const link=event.target.closest('[data-sample-open]');
 if(!link||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const inline=document.querySelector('main [data-sample-form]');
 if(inline){event.preventDefault();inline.closest('.m-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});if(!inline.hidden)inline.elements.name.focus({preventScroll:true});return}
 if(!window.HTMLDialogElement)return; // older browsers follow the link to /free-carousel/
 event.preventDefault();
 const dialog=sampleModal();dialog.showModal();
 dialog.querySelector('[data-sample-form]:not([hidden]) input')?.focus();
});
// A floating reminder once the hero's buttons have scrolled away. Not on the booking page, where it would cover the calendar.
let alreadySent=false;try{alreadySent=localStorage.getItem(sentKey)==='1'}catch{}
if(!alreadySent&&!['/free-carousel/','/dental-demo/'].includes(location.pathname)){
 const fab=document.createElement('a');fab.className='m-sample-fab';fab.href=sampleUrl;fab.dataset.sampleOpen='';
 fab.innerHTML='<img src="/assets/demo/harbour-gum/carousel-01.webp" alt="" width="1080" height="1350" decoding="async"><span><b>Get a free sample carousel</b><small>5 slides in your clinic’s branding</small></span><i aria-hidden="true">→</i>';
 document.body.append(fab);
 const toggle=()=>fab.classList.toggle('show',scrollY>560);addEventListener('scroll',toggle,{passive:true});toggle();
}
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
  measure('appointment_scheduled',uri);
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
