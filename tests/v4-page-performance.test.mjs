import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const item={id:'item',clinic_id:'clinic',week_id:'week',topic:'A helpful topic',type:'carousel',status:'ready',copy_status:'approved',language:'English',caption:'Caption',published:false,sources:[],validation:{},brief:{topic:'Topic',summary:'Summary',facts:[],origin:'knowledge'},frames:[1,2].map(n=>({position:n,heading:`Slide ${n}`,body:'Patient advice',visualPrompt:'Dental illustration',assetId:`asset-${n}`}))};
const apiUrl=moduleUrl(`export const calls=[];let revision=0;export const apiCacheRevision=()=>revision,image=id=>'/image/'+id,bump=()=>revision++;export async function api(path){calls.push(path);if(path.startsWith('/content/'))return {item:${JSON.stringify(item)},jobs:[]};if(path.includes('/library'))return {items:[],weeks:[{id:'week',week_start:'2026-09-28'}]};throw Error(path);}`);
const appUrl=moduleUrl('export const go=()=>{},toast=()=>{},refreshWeek=()=>{},refreshClinic=()=>{};');
const uiUrl=new URL('../web/v4/ui.js',import.meta.url).href;
const base=new URL('../web/v4/pages/review.js',import.meta.url);
const reviewSource=(await readFile(base,'utf8')).replace("'../postpilot.js'",JSON.stringify(new URL('../postpilot.js',base).href)).replace("'../api.js'",JSON.stringify(apiUrl)).replace("'../app.js'",JSON.stringify(appUrl)).replace("'../ui.js'",JSON.stringify(uiUrl)).replace("'../content-form.js'",JSON.stringify(new URL('../content-form.js',base).href));
const review=await import(moduleUrl(reviewSource)),api=await import(apiUrl);
const state={clinic:{id:'clinic',name:'Test clinic',profile:{},brand:{}},frame:0,styles:[],bootstrap:{clinics:[]}};
test('review slide navigation stays local until data changes',async()=>{
 const params=new URLSearchParams('id=item');api.calls.length=0;
 let html=await review.render(state,params);assert.match(html,/Slide 1/);
 state.frame=1;html=await review.render(state,params);assert.match(html,/Slide 2/);
 state.frame=0;await review.render(state,params);assert.deepEqual(api.calls,['/content/item']);
 state.reviewItem={...state.reviewItem,caption:'Freshly polled caption'};html=await review.render(state,params);assert.match(html,/Freshly polled caption/);assert.equal(api.calls.length,1);
 api.bump();await review.render(state,params);assert.equal(api.calls.length,2);
 state.reviewItem=null;await review.render(state,params);assert.equal(api.calls.length,3);
});
test('library fetches its week selector and content together',async()=>{
 const librarySource=(await readFile(new URL('../web/v4/pages/library.js',import.meta.url),'utf8')).replace("'../api.js'",JSON.stringify(apiUrl)).replace("'../app.js'",JSON.stringify(appUrl)).replace("'../ui.js'",JSON.stringify(uiUrl)).replace("'./week.js'",JSON.stringify(moduleUrl("export const itemCard=()=>'';")));
 const library=await import(moduleUrl(librarySource));api.calls.length=0;const html=await library.render(state);assert.match(html,/Week of 2026-09-28/);assert.deepEqual(api.calls,['/clinics/clinic/library?weeks=1']);
});
