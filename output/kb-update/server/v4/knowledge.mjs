import {DENTAL_LIBRARY} from './dental-library.mjs';
// Clinically conservative launch library. Facts are paraphrased from the linked NHS pages.
// Keep source review and clinic fact approval separate; imported website claims are not evidence.
const clean='https://www.nhs.uk/live-well/healthy-teeth-and-gums/how-to-keep-your-teeth-clean/';
const gums='https://www.nhs.uk/conditions/gum-disease/';
const whitening='https://www.nhs.uk/tests-and-treatments/teeth-whitening/';
const breath='https://www.nhs.uk/symptoms/bad-breath/';
const children='https://www.nhs.uk/live-well/healthy-teeth-and-gums/taking-care-of-childrens-teeth/';
const sugar='https://www.nhs.uk/live-well/eat-well/food-types/how-does-sugar-in-our-diet-affect-our-health/';
const specs=[
 ['brushing','The small habit behind a healthier smile','prevention',['General dentistry'],['Brush with fluoride toothpaste twice daily.','Clean all surfaces of your teeth.','Replace a worn toothbrush.'],clean],
 ['between','The spaces your toothbrush cannot reach','prevention',['General dentistry'],['Clean between teeth with floss or interdental brushes.','A dentist can help you choose an appropriate interdental brush.'],clean],
 ['rinse','Should you rinse after brushing?','prevention',['General dentistry'],['Spit out toothpaste after brushing.','Avoid rinsing straight afterwards so fluoride stays on your teeth.'],clean],
 ['mouthwash','Mouthwash is not a shortcut','prevention',['General dentistry'],['Mouthwash does not replace toothbrushing.','Use fluoride mouthwash at a different time from brushing.'],clean],
 ['gums','What bleeding gums could be telling you','patient-faq',['Gum care'],['Bleeding gums can be a sign of gum disease.','Ask a dentist about gums that bleed, feel sore or are swollen.'],gums],
 ['gum-check','A gentler conversation about gum health','patient-faq',['Gum care'],['Gum disease can cause swollen, sore or bleeding gums.','Regular dental checks can help identify gum problems.'],gums],
 ['whitening','Before you book teeth whitening','treatment',['Teeth whitening'],['A dentist can assess whether whitening is suitable for you.','Whitening can cause temporary tooth sensitivity.','Whitening does not change the colour of crowns or fillings.'],whitening],
 ['whitening-faq','One question to ask about whitening','treatment',['Teeth whitening'],['Teeth whitening should be supervised by a dental professional.','Ask about sensitivity and suitability before treatment.'],whitening],
 ['breath','Fresh breath starts with everyday care','patient-faq',['General dentistry'],['Keeping teeth, tongue and mouth clean can help with bad breath.','Persistent bad breath is a reason to ask a dentist for advice.'],breath],
 ['children','Helping small smiles build good habits','family',['Children’s dentistry'],['Help children brush their teeth with fluoride toothpaste.','Supervise brushing until children can clean their teeth thoroughly.'],children],
 ['sugar','A kinder choice for your teeth','prevention',['General dentistry'],['Too much sugar can contribute to tooth decay.','Reducing sugary foods and drinks supports oral health.'],sugar],
 ['brush-choice','Electric or manual: what matters most?','prevention',['General dentistry'],['Both manual and electric toothbrushes can clean teeth well.','Thorough brushing matters more than the type of brush.'],clean]
];
const LAUNCH_CARDS=specs.map(([id,topic,pillar,serviceTags,verifiedFacts,url])=>({id,vertical:'dental',topic,pillar,serviceTags,verifiedFacts,prohibitedClaims:['guaranteed results','painless treatment','permanent cure','invented prices or statistics'],sources:[{title:'NHS patient information',url}],lastReviewedAt:'2026-10-02',suitableFormats:['carousel','post','story'],engagementAngles:[{id:`${id}:faq`,label:'Patient FAQ',hook:topic},{id:`${id}:checklist`,label:'Before-you-book checklist',hook:`A simple checklist: ${topic.toLowerCase()}`},{id:`${id}:mistake`,label:'Common misconception',hook:`Let’s talk about ${topic.toLowerCase()}`}]}));
const importedCards=DENTAL_LIBRARY.map(row=>({
 id:row.content_id,topicClusterId:row.topic_cluster_id,vertical:'dental',topic:row.topic,pillar:row.pillar,
 serviceTags:[row.treatment_service],verifiedFacts:[],sources:[],reviewStatus:'requires-source-review',
 prohibitedClaims:[row.claim_guardrail,row.source_requirement],sourceRequirement:row.source_requirement,
 planningBrief:row.content_brief,libraryEntry:row,suitableFormats:[row.type==='content'?'post':row.type],
 engagementAngles:[{id:`${row.content_id}:recipe`,label:row.angle_recipe,hook:row.hook}]
}));
export const KNOWLEDGE_CARDS=[...LAUNCH_CARDS,...importedCards];
const topicKey=card=>String(card?.topicClusterId||card?.topic||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function usedByClinic(card,clinic,history){
 return history.some(h=>h.clinic_id===clinic.id&&(h.knowledge_card_id===card.id||
  (cardById(h.knowledge_card_id)&&topicKey(cardById(h.knowledge_card_id))===topicKey(card))));
}
export const cardById=id=>KNOWLEDGE_CARDS.find(c=>c.id===id);
const tokens=text=>new Set(String(text).toLowerCase().match(/[a-z]{3,}/g)||[]);
export function similarity(a,b){const x=tokens(a),y=tokens(b);const intersection=[...x].filter(t=>y.has(t)).length;return intersection/Math.max(1,new Set([...x,...y]).size);}
export function rankCards(clinic,history=[],excluded=[],format='carousel',now=Date.now()) {
 const services=(clinic.profile.services||[]).join(' ').toLowerCase(),emphasis=String(clinic.profile.emphasis||'').toLowerCase();
 return KNOWLEDGE_CARDS.filter(c=>c.suitableFormats.includes(format)&&!excluded.includes(c.id)&&!excluded.some(id=>topicKey(cardById(id))===topicKey(c))&&!usedByClinic(c,clinic,history)).flatMap(c=>c.engagementAngles.map(a=>{
  let score=20+(c.serviceTags.some(s=>services.includes(s.toLowerCase()))?8:0)+(emphasis&&c.serviceTags.some(s=>s.toLowerCase().includes(emphasis))?12:0);
  if(clinic.profile.goal==='Educate existing patients'&&c.pillar==='prevention')score+=5;
  if(clinic.profile.goal==='Build trust in our treatments'&&c.pillar==='treatment')score+=5;
  for(const h of history){const days=(now-Date.parse(h.generated_at))/86400000;if(days<0)continue;const own=h.clinic_id===clinic.id;
   if(h.knowledge_card_id===c.id&&own&&days<90)score-=80;
   if(h.angle_id===a.id&&own&&days<45)score-=50;
   if(h.knowledge_card_id===c.id&&days<28)score-=h.region===clinic.profile.location?20:8;
   if(h.angle_id===a.id&&days<14)score-=20;
   if(own&&days<7&&h.recipe_id?.endsWith(a.label))score-=6;
   if(own&&days<7&&cardById(h.knowledge_card_id)?.pillar===c.pillar)score-=3;
   if(h.recipe_id===`${format}:${a.label}`&&h.knowledge_card_id===c.id&&days<14)score-=25;
   if(own&&similarity(a.hook,h.headline)>.7)score-=60;
   if(own&&h.status==='rejected'&&h.knowledge_card_id===c.id)score-=15;
  }
  return {card:c,angle:a,score,tie:[...`${clinic.id}:${a.id}`].reduce((hash,ch)=>(Math.imul(hash,31)+ch.charCodeAt(0))>>>0,2166136261)};
 })).sort((a,b)=>b.score-a.score||a.tie-b.tie);
}
export function makeCopy(card,angle,type,clinic){
 const cta=clinic.brand.bookingUrl?'Book a visit through our clinic link.':'Ask our clinic for advice that fits your needs.';
 const facts=card.verifiedFacts;
 const clinicFacts=(clinic.profile.facts||[]).filter(f=>f.status==='verified'&&f.text).map(f=>f.text).slice(0,1);
 const postFacts=type==='post'?[...facts,...clinicFacts]:facts;
 const frames=type==='carousel'?[{heading:angle.hook,body:'A little clarity for your everyday dental care.'},...Array.from({length:3},(_,i)=>({heading:['Good to know','A helpful habit','Your next step'][i],body:facts[i]||cta})),{heading:'Your smile, your questions',body:cta}]:[{heading:angle.hook,body:type==='story'?facts[0]:postFacts.join(' ')}];
 return {frames:frames.map((f,i)=>({...f,position:i+1,assetId:'',approved:false})),caption:`${angle.hook}\n\n${postFacts.join(' ')}\n\n${cta}\n#DentalCare #HealthySmiles`,cta};
}
export function validateCopy(frames,caption,card,clinic){
 const allowed=makeCopy(card,card.engagementAngles[0],'carousel',clinic);
 const approved=clinic.profile.facts?.filter(f=>f.status==='verified').map(f=>f.text)||[];
 const safe=[...card.verifiedFacts,...approved,...allowed.frames.flatMap(f=>[f.heading,f.body]),...card.engagementAngles.map(a=>a.hook),clinic.name,'Book a visit through our clinic link.','Ask our clinic for advice that fits your needs.','#DentalCare #HealthySmiles'];
 const text=[...frames.flatMap(f=>[f.heading,f.body]),caption].join(' ');
 if(/guarantee|100\s*%|painless|permanent cure|best clinic|instant results|risk.free/i.test(text))return {valid:false,reason:'Unsupported medical or outcome claim. Use the source-backed wording.'};
 const numbers=text.match(/\b\d+(?:\.\d+)?\s*%?/g)||[];
 if(numbers.some(n=>!safe.some(f=>f.includes(n))))return {valid:false,reason:'This number is not supported by an approved fact.'};
 // A fail-closed source-span gate: arbitrary medical paraphrases cannot bypass review.
 for(const part of [...frames.flatMap(f=>[f.heading,f.body]),...String(caption).split(/\n+/)].filter(Boolean)){
  const remaining=safe.reduce((v,f)=>v.split(f).join(''),part).replace(/[\s.,!?;:—–-]/g,'');
  if(remaining)return {valid:false,reason:'This wording is outside the approved source material. Select a source-backed phrase or update confirmed clinic facts.'};
 }
 return {valid:true};
}
