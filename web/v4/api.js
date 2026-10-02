let csrf='';
export const setCsrf=value=>csrf=value||'';
export async function api(path,{method='GET',body,raw=false,headers:extraHeaders={}}={}){const headers={...extraHeaders};if(body!==undefined&&!raw)headers['Content-Type']='application/json';if(raw)headers['Content-Type']=body.type;if(csrf&&method!=='GET')headers['X-CSRF-Token']=csrf;const r=await fetch(path.startsWith('/api/')?path:`/api/v4${path}`,{method,headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),credentials:'same-origin'});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error||'Please try again.'),{status:r.status});return value}
export const image=(id,variant='preview')=>id?`/api/v4/assets/${encodeURIComponent(id)}/${variant}`:'';
