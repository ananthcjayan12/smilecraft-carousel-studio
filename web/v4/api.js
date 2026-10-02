let csrf='';
const cache=new Map(),pending=new Map();let cacheRevision=0;
export const apiCacheRevision=()=>cacheRevision;
export function clearApiCache(){cache.clear();cacheRevision++;}

export const setCsrf=value=>csrf=value||'';
export async function api(path,{method='GET',body,raw=false,headers:extraHeaders={},cache:useCache=true}={}){
 const url=path.startsWith('/api/')?path:`/api/v4${path}`,revision=cacheRevision;
 const cacheable=method==='GET'&&useCache&&!url.includes('refresh=1');
 const saved=cache.get(url);if(cacheable&&saved&&saved.expires>Date.now())return structuredClone(saved.value);
 const key=`${revision}:${url}`;if(method==='GET'&&pending.has(key))return structuredClone(await pending.get(key));
 if(method!=='GET')clearApiCache();
 const request=(async()=>{const started=performance.now(),headers={...extraHeaders};if(body!==undefined&&!raw)headers['Content-Type']='application/json';if(raw)headers['Content-Type']=body.type;if(csrf&&method!=='GET')headers['X-CSRF-Token']=csrf;
 const r=await fetch(url,{method,headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),credentials:'same-origin'});const value=await r.json();if(url.startsWith('/api/v4/bootstrap'))console.debug('Studio startup request',Math.round(performance.now()-started)+'ms',r.headers.get('Server-Timing')||'');if(!r.ok)throw Object.assign(Error(value.error||'Please try again.'),{status:r.status});
 if(method==='GET'&&revision===cacheRevision)cache.set(url,{value,expires:Date.now()+15000});return value;})();
 if(method==='GET')pending.set(key,request);
 try{return structuredClone(await request);}finally{if(method==='GET'&&pending.get(key)===request)pending.delete(key);}
}

export const image=(id,variant='preview')=>id?`/api/v4/assets/${encodeURIComponent(id)}/${variant}`:'';
