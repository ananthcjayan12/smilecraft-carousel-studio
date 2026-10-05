const fail=(message,status=409)=>Object.assign(Error(message),{status});
export function createPostpilot({baseUrl,apiKey,fetcher=fetch}){
 const origin=new URL(baseUrl).origin;
 async function request(path,{method='GET',body}={}){
  const response=await fetcher(origin+path,{method,redirect:'manual',headers:{Authorization:`Bearer ${apiKey}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw fail(`PostPilot request failed (${response.status}). Check the connection and PostPilot account.`,502);
  return response.json();
 }
 async function readiness(schedule=false){
  const data=await request('/api/accounts');
  if(!data.accounts?.instagram?.connected)throw fail('Connect this clinic’s Instagram account in PostPilot first.');
  if(!data.readiness?.publicMediaUrlConfigured||!data.readiness?.instagramConfigured)throw fail('PostPilot Instagram publishing is not ready. Check its Accounts settings.');
  if(schedule&&(await request('/api/settings')).schedulerEnabled===false)throw fail('Enable scheduling in PostPilot Settings first.');
  return {account:data.accounts.instagram};
 }
 async function upload(image,name){
  const bytes=new Uint8Array(image.bytes),reservation=await request('/api/media/uploads',{method:'POST',body:{name,type:image.mime,size:bytes.byteLength}});
  if(!reservation.id||!Number.isSafeInteger(reservation.partSize)||reservation.partSize<=0)throw fail('PostPilot returned an invalid upload reservation.',502);
  try{
   const parts=[];
   for(let offset=0,n=1;offset<bytes.length;offset+=reservation.partSize,n++){
    const part=await request(`/api/media/uploads/${reservation.id}/parts`,{method:'POST',body:{partNumber:n}}),url=new URL(part.url,origin);
    if(url.protocol!=='https:'||(part.local&&url.origin!==origin))throw fail('PostPilot returned an invalid upload URL.',502);
    const response=await fetcher(url.href,{method:'PUT',redirect:'manual',headers:part.local?{Authorization:`Bearer ${apiKey}`}:{},body:bytes.slice(offset,offset+reservation.partSize),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw fail('PostPilot image upload failed.',502);
    const etag=part.local?(await response.json()).etag:response.headers.get('etag')?.replace(/^"|"$/g,'');
    if(!etag)throw fail('PostPilot upload did not return a part receipt.',502);
    parts.push({partNumber:n,etag});
   }
   return await request(`/api/media/uploads/${reservation.id}/complete`,{method:'POST',body:{parts}});
  }catch(error){await request(`/api/media/uploads/${reservation.id}/abort`,{method:'POST',body:{}}).catch(()=>{});throw error;}
 }
 return {request,readiness,upload};
}
