import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {apiRoute} from '../cloudflare/studio.mjs';
function fixture(){
 const sqlite=new Database(':memory:');sqlite.exec(readFileSync('cloudflare/migrations/0001_accounts_credits.sql','utf8'));sqlite.exec(readFileSync('cloudflare/migrations/0017_admin_credit_adjustments.sql','utf8'));
 sqlite.exec("INSERT INTO accounts(id,name) VALUES('clinic','Clinic'),('other','Other'); INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES('initial','clinic',100,'manual','initial');");
 const DB={prepare(sql){return {bind(...args){const stmt=sqlite.prepare(sql);return {first:async()=>stmt.get(...args),run:async()=>({meta:stmt.run(...args)}),execute:()=>stmt.run(...args)};}}},batch:async statements=>sqlite.transaction(()=>statements.map(s=>s.execute()))()};
 const viewer={email:'admin@example.com',user_id:'admin',account_id:'admin'};
 const call=async(input={},user=viewer,target='clinic')=>{const url=new URL(`https://studio.test/api/admin/accounts/${target}/credits`);const response=await apiRoute(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'add',amount:50,expectedBalance:100,reason:'Clinic top-up',requestId:'adjust-request-0001',...input})}),{DB,ADMIN_EMAIL:'admin@example.com'},user,url);return {status:response.status,...await response.json()};};
 return {sqlite,call};
}
test('admin can top up, deduct and set balances with a complete audit record',async()=>{
 const f=fixture();try{
 assert.equal((await f.call()).credits,150);
 assert.equal((await f.call({mode:'remove',amount:20,expectedBalance:150,requestId:'adjust-request-0002'})).credits,130);
 assert.equal((await f.call({mode:'set',amount:0,expectedBalance:130,requestId:'adjust-request-0003'})).credits,0);
 const rows=f.sqlite.prepare('SELECT * FROM admin_credit_adjustments ORDER BY id').all();assert.equal(rows.length,3);assert.equal(rows[0].admin_user_id,'admin');assert.equal(rows[0].reason,'Clinic top-up');assert.deepEqual(rows.map(r=>r.amount),[50,-20,-130]);assert.equal(rows[2].before_balance,130);assert.equal(rows[2].after_balance,0);
 }finally{f.sqlite.close();}
});
test('non-admins, missing accounts, invalid values and overdrafts cannot change credits',async()=>{
 const f=fixture();try{
 assert.equal((await f.call({}, {email:'client@example.com'})).status,403);
 assert.equal((await f.call({},undefined,'missing')).status,404);
 for(const input of [{amount:1.5},{amount:-1},{amount:0},{amount:'50'},{amount:1000001},{reason:''},{mode:'invalid'},{requestId:'bad'},{mode:'remove',amount:101}])assert.equal((await f.call(input)).status,400,JSON.stringify(input));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM credit_ledger').get().n,1);
 }finally{f.sqlite.close();}
});
test('repeat submissions are idempotent and stale balances or reserved credits block deductions',async()=>{
 const f=fixture();try{
 assert.equal((await f.call()).credits,150);assert.equal((await f.call()).credits,150);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM admin_credit_adjustments').get().n,1);
 assert.equal((await f.call({amount:60})).status,409);
 assert.equal((await f.call({requestId:'adjust-request-0002'})).status,409);
 f.sqlite.exec("INSERT INTO generation_jobs(id,account_id,project_id,action,model_id,status,idempotency_key,quoted_credits) VALUES('reservation','clinic','project','image','model','running','reservation',100); INSERT INTO credit_reservations(job_id,account_id,amount,status) VALUES('reservation','clinic',100,'reserved');");
 assert.equal((await f.call({mode:'remove',amount:60,expectedBalance:150,requestId:'adjust-request-0003'})).status,409);
 assert.equal((await f.call({mode:'remove',amount:51,expectedBalance:50,requestId:'adjust-request-0004'})).status,400);
 assert.equal((await f.call({mode:'set',amount:20,expectedBalance:50,requestId:'adjust-request-0005'})).credits,20);
 }finally{f.sqlite.close();}
});
