import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {postpilotSettings} from '../server/v4/postpilot-settings.mjs';
function fixture(){
 const sqlite=new Database(':memory:');sqlite.exec(readFileSync('cloudflare/migrations/0016_postpilot_connections.sql','utf8'));
 const db={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args),run:async()=>({meta:stmt.run(...args)})};}}}};
 let connected=true;const keys=[];
 const settings=postpilotSettings(db,{fetcher:async(url,opts)=>{keys.push(opts.headers.Authorization);return Response.json({accounts:{instagram:{connected,username:'clinic_instagram'}},readiness:{instagramConfigured:true,publicMediaUrlConfigured:true}});}});
 return {sqlite,settings,keys,setConnected:value=>connected=value};
}
const input={baseUrl:'https://postpilot.ananth-c-jayan.workers.dev/',apiKey:'ppk_private_key'};
test('Settings saves a verified connection, retains or replaces keys, and never returns secrets',async()=>{
 const f=fixture();try{
 const result=await f.settings.save('A','clinic',input);assert.equal(result.configured,true);assert.equal(result.account.username,'clinic_instagram');assert.ok(!JSON.stringify(result).includes(input.apiKey));
 const read=await f.settings.read('A','clinic');assert.ok(read.configured);assert.ok(!JSON.stringify(read).includes(input.apiKey));
 await f.settings.save('A','clinic',{baseUrl:input.baseUrl,apiKey:''});assert.equal(f.keys.at(-1),'Bearer ppk_private_key');
 await f.settings.save('A','clinic',{baseUrl:input.baseUrl,apiKey:'ppk_replacement'});assert.equal(f.keys.at(-1),'Bearer ppk_replacement');
 assert.equal((await f.settings.check('A','clinic')).account.username,'clinic_instagram');
 assert.equal((await f.settings.remove('A','clinic')).configured,false);assert.equal(await f.settings.connection('A','clinic'),null);
 }finally{f.sqlite.close();}
});
test('connections are isolated by clinic and account; failed checks preserve the previous key',async()=>{
 const f=fixture();try{
 await f.settings.save('A','one',input);
 assert.equal((await f.settings.read('B','one')).configured,false);assert.equal((await f.settings.read('A','two')).configured,false);
 assert.equal(await f.settings.connection('B','one'),null);
 f.setConnected(false);await assert.rejects(f.settings.save('A','one',{...input,apiKey:'ppk_bad'}),/Connect.*Instagram/);
 assert.equal(f.sqlite.prepare('SELECT api_key FROM v4_postpilot_connections').get().api_key,input.apiKey);
 await f.settings.remove('B','one');assert.equal((await f.settings.read('A','one')).configured,true);
 }finally{f.sqlite.close();}
});
test('Settings rejects insecure origins, invalid keys and changing origins without a new key',async()=>{
 const f=fixture();try{
 for(const baseUrl of ['http://example.com','https://127.0.0.1','https://localhost','https://example.com/path'])await assert.rejects(f.settings.save('A','clinic',{...input,baseUrl}),/HTTPS/);
 await assert.rejects(f.settings.save('A','clinic',{...input,apiKey:'bad'}),/valid.*key/);
 await f.settings.save('A','clinic',input);await assert.rejects(f.settings.save('A','clinic',{baseUrl:'https://another.com',apiKey:''}),/changing/);
 }finally{f.sqlite.close();}
});
