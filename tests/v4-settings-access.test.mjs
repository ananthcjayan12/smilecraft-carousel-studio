import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shell} from '../web/v4/ui.js';
const source=await readFile(new URL('../web/v4/pages/settings.js',import.meta.url),'utf8');
const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const app=url('export const go=()=>{},toast=()=>{},refreshClinic=()=>{},ensureWeek=()=>{};');
const api=url(`export const calls=[];export async function api(path){calls.push(path);if(path==='/providers')return {tasks:Object.fromEntries(['writing','validation','style','artwork'].map(t=>[t,{provider:'openai',model:t==='style'||t==='artwork'?'gpt-image-2.5-flare':'writer'}])),providers:{openai:{available:true,label:'OpenAI',models:[['gpt-image-2.5-flare','Flare']],writingModels:[['writer','Writer']]}}};if(path==='/api/admin/accounts')return {accounts:[{id:'client',email:'client@example.com',name:'Clinic',credits:900,planId:'founding-clinic'}]};if(path==='/api/plans')return {plans:[{id:'founding-clinic',monthlyCredits:900}]};throw Error(path);}`);
let rewritten=source.replace("'../../image-options.js'",JSON.stringify(new URL('../web/image-options.js',import.meta.url).href)).replace("'../ui.js'",JSON.stringify(new URL('../web/v4/ui.js',import.meta.url).href)).replace("'../api.js'",JSON.stringify(api)).replace("'../app.js'",JSON.stringify(app));
const settings=await import(url(rewritten)),mock=await import(api);
const state={me:{isAdmin:false,user:{email:'client@example.com'},account:{id:'client'}},bootstrap:{capabilities:{local:false},activation:{active:true,credits:900},clinics:[]},clinic:null};
test('client settings make no provider requests and expose no model or advanced studio controls',async()=>{
 const html=await settings.render(state,new URLSearchParams());assert.equal(mock.calls.length,0);assert.doesNotMatch(html,/data-form="providers"|legacy.html|data-form="activate"/);
 assert.doesNotMatch(shell(state,'/settings',html),/legacy.html|Admin dashboard/);
});
test('admin dashboard exposes global models, client balances, and allocation controls',async()=>{
 const admin={...state,me:{...state.me,isAdmin:true}};
 const html=await settings.render(admin,new URLSearchParams('admin=1'));
 assert.match(html,/AI models for all clients/);assert.match(html,/data-form="activate"/);assert.match(html,/900 credits/);assert.match(html,/legacy.html/);
 assert.deepEqual(mock.calls,['/providers','/api/admin/accounts','/api/plans']);
 assert.match(shell(admin,'/admin',html),/Admin dashboard/);
});

test('PostPilot Settings offers connection controls without prefilling secrets',()=>{
 const clinic={id:'clinic',name:'Test Clinic'};
 const disconnected=settings.postpilotForm(clinic,{configured:false});assert.match(disconnected,/data-form="postpilot-connection"/);assert.match(disconnected,/type="password"/);assert.match(disconnected,/Connect PostPilot/);
 const connected=settings.postpilotForm(clinic,{configured:true,baseUrl:'https://postpilot.ananth-c-jayan.workers.dev',apiKey:'ppk_secret',account:{username:'clinic_instagram'}});assert.match(connected,/Check connection/);assert.match(connected,/Disconnect/);assert.match(connected,/clinic_instagram/);assert.doesNotMatch(connected,/ppk_secret/);
});
