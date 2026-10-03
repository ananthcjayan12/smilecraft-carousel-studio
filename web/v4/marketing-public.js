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
const demoForm=document.querySelector('#demo-request-form');
if(demoForm)demoForm.addEventListener('submit',event=>{
 event.preventDefault();
 const sample=demoForm.dataset.request==='sample';
 const instagram=demoForm.elements.instagram,website=demoForm.elements.website;
 if(sample){instagram.setCustomValidity(instagram.value.trim()||website.value.trim()?'':'Please provide your clinic’s Instagram or website.');}
 if(!demoForm.reportValidity())return;
 const data=new FormData(demoForm),utm=new URLSearchParams(location.search);
 const source=['utm_source','utm_medium','utm_campaign','utm_content'].filter(key=>utm.has(key)).map(key=>`${key}: ${utm.get(key).slice(0,200)}`).join('\n');
 const body=`${sample?'Free branded carousel request':'Dental content demo request'}\n\nName: ${data.get('name')}\nReply email: ${data.get('email')}\nPractice: ${data.get('practice')}\nInstagram: ${data.get('instagram')||''}\nWebsite: ${data.get('website')||''}\nCountry: ${data.get('country')}\nRole: ${data.get('role')||''}\nPreferred times: ${data.get('times')||''}\n\nI requested contact about this ${sample?'free sample and am authorised to share this clinic’s branding':'demo'} and read the privacy notice.\n\n${source}`;
 const link=document.querySelector('#demo-email-link');link.href=`mailto:${supportEmail}?subject=${encodeURIComponent(sample?'Srshti free branded carousel request':'Srshti dental content demo request')}&body=${encodeURIComponent(body)}`;link.hidden=false;
 document.querySelector('#demo-request-status').textContent=sample?'Your sample request draft is ready. Open it below and send it; we will confirm acceptance and delivery timing by email.':'Your email draft is ready. Open it below and send it to request a time. A meeting has not been booked yet.';
});
demoForm?.addEventListener('input',()=>demoForm.elements.instagram?.setCustomValidity(''));
const calendarUrl=validatedCalendarUrl(marketingConfig.bookingUrl);
if(calendarUrl&&document.querySelector('#calendar-booking')){
 document.querySelector('#calendar-booking').hidden=false;
 document.querySelector('#calendar-fallback')?.remove();
 const utm=new URLSearchParams(location.search);for(const key of ['utm_source','utm_medium','utm_campaign','utm_content'])if(utm.has(key))calendarUrl.searchParams.set(key,utm.get(key).slice(0,200));
 document.querySelector('#calendar-link').href=calendarUrl.href;
 const embedded=new URL(calendarUrl);embedded.searchParams.set('embed_domain',location.hostname);embedded.searchParams.set('embed_type','Inline');
 const frame=document.createElement('iframe');frame.src=embedded.href;frame.title='Book a 15-minute Srshti dental content demo';frame.referrerPolicy='strict-origin-when-cross-origin';document.querySelector('#calendar-embed').append(frame);
 const seen=new Set();
 window.addEventListener('message',event=>{
  const uri=confirmedBooking(event,frame.contentWindow);if(!uri||seen.has(uri))return;seen.add(uri);
  document.querySelector('#booking-status').textContent='Your demo is booked. Check your email for the confirmation and joining details.';
  if(measurementAllowed&&marketingConfig.pixelId){loadPixel();window.oaiq('measure','appointment_scheduled',{type:'customer_action'},{event_id:uri});}
 });
}
