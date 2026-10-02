import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/v4/app.js',import.meta.url),'utf8');
const moduleUrl=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
async function fixture(t,route,{workspace=false,conflict=false}={}){
 const clinic={id:'saved',name:'River Dental',revision:1,status:'onboarding',profile:{},brand:{},styleSelection:{}};
 const bootstrap={me:{user:{email:'owner@example.com'},csrf:'csrf'},clinics:[clinic],activation:{active:false},capabilities:{},...(workspace?{workspace:{clinic,styles:[],jobs:[]}}:{})};
 const apiUrl=moduleUrl(`// Fixture route: ${route}\nexport const calls=[];let conflict=${conflict};export const setCsrf=()=>{},apiCacheRevision=()=>0;export async function api(path,options={}){calls.push({path,...options});if(path.includes('/library'))return {items:[],weeks:[]};if(path.startsWith('/bootstrap'))return ${JSON.stringify(bootstrap)};if(path.endsWith('/profile')){if(conflict){conflict=false;throw Object.assign(Error('conflict'),{status:409})}return {clinic:{...${JSON.stringify(clinic)},revision:3}}}if(path==='/clinics/saved')return {clinic:{...${JSON.stringify(clinic)},revision:2},styles:[],jobs:[]};throw Error('Unexpected request: '+path);}`);
 const uiUrl=moduleUrl('export const shell=(state,route,html)=>html,esc=String;');
 const pageUrl=moduleUrl("export const render=()=>'<p>Ready</p>';");
 const idleCallbacks=[];const root={dataset:{},innerHTML:'',addEventListener(){},querySelector(){return null;}};
 const document={hidden:false,activeElement:null,querySelector:()=>root};
 for(const [name,value] of Object.entries({document,window:{addEventListener(){},scrollTo(){},requestIdleCallback(callback){idleCallbacks.push(callback)}},location:{hash:'#'+route,href:''},localStorage:{getItem:()=>clinic.id}})){
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});t.after(()=>descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name]);
 }
 const code=source.replace("'./api.js'",JSON.stringify(apiUrl)).replace("'./ui.js'",JSON.stringify(uiUrl)).replace(/import\('\.\/pages\/[^']+'\)/g,`import(${JSON.stringify(pageUrl)})`).replace('void start();','await start();');
 return {app:await import(moduleUrl(code)),api:await import(apiUrl),root,idleCallbacks};
}
test('settings startup uses one bootstrap request and does not load unused clinic jobs',async t=>{
 const f=await fixture(t,'/settings');assert.equal(f.root.innerHTML,'<p>Ready</p>');assert.deepEqual(f.api.calls.map(c=>c.path),['/bootstrap?clinic=saved']);
});
test('clinic setup opens from bundled clinic data without a second request',async t=>{
 const f=await fixture(t,'/setup?step=profile',{workspace:true});assert.equal(f.root.innerHTML,'<p>Ready</p>');assert.deepEqual(f.api.calls.map(c=>c.path),['/bootstrap?clinic=saved&include=clinic']);
 await f.app.saveProfile({name:'Updated clinic'});assert.equal(f.api.calls.length,2);assert.equal(f.api.calls[1].body.revision,1);
});
test('a background import conflict refreshes the revision and retries the clinic save',async t=>{
 const f=await fixture(t,'/setup?step=profile',{workspace:true,conflict:true});await f.app.saveProfile({name:'Updated clinic'});
 assert.deepEqual(f.api.calls.slice(1).map(c=>c.path),['/clinics/saved/profile','/clinics/saved','/clinics/saved/profile']);assert.equal(f.api.calls.at(-1).body.revision,2);assert.equal(f.app.state.clinic.revision,3);
});


test('opening review includes clinic styles for editing without another workspace read',async t=>{
 const f=await fixture(t,'/review?id=item',{workspace:true});assert.deepEqual(f.api.calls.map(c=>c.path),['/bootstrap?clinic=saved&include=clinic']);
});


test('opening page renders before idle preloading warms routine navigation',async t=>{
 const f=await fixture(t,'/settings?preload=1');assert.equal(f.root.innerHTML,'<p>Ready</p>');assert.equal(f.api.calls.length,1);assert.equal(f.idleCallbacks.length,1);
 f.idleCallbacks[0]();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.api.calls.map(c=>c.path),['/bootstrap?clinic=saved','/clinics/saved/library?weeks=1','/clinics/saved']);
});
