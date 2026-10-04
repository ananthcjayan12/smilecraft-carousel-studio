import test from 'node:test';
import assert from 'node:assert/strict';
import {matchDemoUser,loginPage,authRoute} from '../cloudflare/auth.mjs';

const users=[{id:'r',identity_subject:'Rosebay Family Dental'},{id:'h',identity_subject:'Harbour Gum Dental'}];
test('demo clinic names match loosely but never on tiny input',()=>{
 assert.equal(matchDemoUser(users,'rosebay family dental')?.id,'r');
 assert.equal(matchDemoUser(users,'Harbour Gum')?.id,'h');
 assert.equal(matchDemoUser(users,'  ROSEBAY ')?.id,'r');
 assert.equal(matchDemoUser(users,'ro'),null);
 assert.equal(matchDemoUser(users,'Smile Clinic'),null);
});
test('demo form only renders when enabled',async()=>{
 assert.doesNotMatch(await loginPage({}).text(),/api\/auth\/demo/);
 assert.match(await loginPage({DEMO_LOGIN:'on'}).text(),/api\/auth\/demo/);
});
test('demo route is closed unless enabled and same-origin',async()=>{
 const env={APP_ORIGIN:'https://app.test'},req=origin=>new Request('https://app.test/api/auth/demo',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({clinic:'Rosebay',password:'x'})});
 assert.equal((await authRoute(req('https://app.test'),env,new URL('https://app.test/api/auth/demo'))).status,404);
 assert.equal((await authRoute(req('https://evil.test'),{...env,DEMO_LOGIN:'on'},new URL('https://app.test/api/auth/demo'))).status,403);
});
test('demo route opens a seeded clinic and rejects a wrong password when one is set',async()=>{
 const sessions=[];
 const DB={prepare:sql=>({all:async()=>({results:users}),bind:(...a)=>({run:async()=>{sessions.push(a);return {meta:{changes:1}}}})})};
 const env={APP_ORIGIN:'https://app.test',DEMO_LOGIN:'on',DB},url=new URL('https://app.test/api/auth/demo');
 const req=(clinic,password)=>new Request(url,{method:'POST',headers:{Origin:'https://app.test'},body:new URLSearchParams({clinic,password})});
 const ok=await authRoute(req('Rosebay','anything'),env,url);
 assert.equal(ok.headers.get('Location'),'https://app.test/');assert.match(ok.headers.get('Set-Cookie'),/cs_session=/);assert.equal(sessions[0][1],'r');
 assert.match((await authRoute(req('Nobody','x'),env,url)).headers.get('Location'),/error=/);
 assert.match((await authRoute(req('Rosebay','wrong'),{...env,DEMO_PASSWORD:'smile'},url)).headers.get('Location'),/error=/);
 assert.equal((await authRoute(req('Rosebay','smile'),{...env,DEMO_PASSWORD:'smile'},url)).headers.get('Location'),'https://app.test/');
 assert.equal((await authRoute(req('Rosebay','whatever'),{...env,DEMO_PASSWORD:'any'},url)).headers.get('Location'),'https://app.test/');
});
