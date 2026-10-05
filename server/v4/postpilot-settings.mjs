import {createPostpilot} from './postpilot.mjs';
import {publicUrl} from './extract.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function postpilotSettings(db,{fetcher}={}){
 const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 const row=(account,clinicId)=>first('SELECT * FROM v4_postpilot_connections WHERE account_id=? AND clinic_id=?',account,clinicId);
 const client=saved=>createPostpilot({baseUrl:saved.base_url,apiKey:saved.api_key,...(fetcher?{fetcher}:{})});
 const safe=saved=>({configured:Boolean(saved),baseUrl:saved?.base_url||'https://postpilot.ananth-c-jayan.workers.dev'});
 return {
  async connection(account,clinicId){const saved=await row(account,clinicId);return saved?client(saved):null;},
  async read(account,clinicId){return safe(await row(account,clinicId));},
  async save(account,clinicId,input){
   const existing=await row(account,clinicId);let url;try{url=publicUrl(input.baseUrl)}catch{throw fail('Enter a public HTTPS PostPilot URL.');}
   if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw fail('Enter a public HTTPS PostPilot origin without a path.');
   const key=String(input.apiKey||'').trim();
   if(!key&&existing?.base_url!==url.origin)throw fail('Enter an API key when changing the PostPilot URL.');
   const apiKey=key||existing?.api_key;if(!apiKey||apiKey.length>1000||!apiKey.startsWith('ppk_')||/\s/.test(apiKey))throw fail('Enter a valid PostPilot API key.');
   const candidate={base_url:url.origin,api_key:apiKey};
   const ready=await client(candidate).readiness();
   await run('INSERT INTO v4_postpilot_connections(account_id,clinic_id,base_url,api_key,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,clinic_id) DO UPDATE SET base_url=excluded.base_url,api_key=excluded.api_key,updated_at=excluded.updated_at',account,clinicId,url.origin,apiKey,new Date().toISOString());
   return {...safe(candidate),account:ready.account};
  },
  async check(account,clinicId){const saved=await row(account,clinicId);if(!saved)throw fail('Connect PostPilot first.');return {...safe(saved),...await client(saved).readiness()};},
  async remove(account,clinicId){await run('DELETE FROM v4_postpilot_connections WHERE account_id=? AND clinic_id=?',account,clinicId);return safe(null);}
 };
}
