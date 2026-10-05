const fail=(message,status=409)=>Object.assign(Error(message),{status});
export async function postpilotRoute({platform,account,item,clinic,request}){
 const db=platform.db;
 const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
 const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 const connection=await platform.postpilot?.(clinic.id);
 if(!connection){if(request.method!=='GET')throw fail('Configure this clinic’s PostPilot connection first.',503);return {configured:false};}
 let saved=await first('SELECT * FROM v4_postpilot WHERE account_id=? AND content_id=?',account,item.id);
 const view=()=>({configured:true,delivery:saved?{postId:saved.post_id,status:saved.status,error:saved.error,revision:saved.revision,...JSON.parse(saved.result_json)}:null});
 const update=async(status,result={},error=null)=>{
  await run('UPDATE v4_postpilot SET status=?,result_json=?,error=?,updated_at=? WHERE account_id=? AND content_id=?',status,JSON.stringify(result),error,new Date().toISOString(),account,item.id);
  saved=await first('SELECT * FROM v4_postpilot WHERE account_id=? AND content_id=?',account,item.id);
 };
 if(request.method==='GET'){
  const ready=await connection.readiness();
  if(saved?.post_id){
   const result=await connection.request(`/api/posts/${encodeURIComponent(saved.post_id)}`);await update(result.status,result);
   if(result.status==='published'&&result.targetStatuses?.instagram==='success'){
    const snapshot=JSON.parse(saved.payload_json);
    await run("INSERT OR IGNORE INTO v4_usage(id,account_id,clinic_id,content_id,knowledge_card_id,angle_id,recipe_id,region,headline,status,generated_at) VALUES(?,?,?,?,?,?,?,?,?,'published',?)",`postpilot:${saved.post_id}`,account,clinic.id,item.id,snapshot.knowledgeCardId,snapshot.angleId,snapshot.recipeId,snapshot.region,snapshot.topic,new Date().toISOString());
   }
  }
  return {...view(),account:ready.account};
 }
 const raw=await request.text();if(raw.length>65000)throw fail('Request too large.',413);
 let input;try{input=JSON.parse(raw)}catch{throw fail('Invalid JSON.',400)}
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Expected an object.',400);
 const action=input.action;
 if(!['publish','schedule','retry'].includes(action))throw fail('Choose publish or schedule.',400);
 if(item.type!=='carousel'||item.frames.length<2||item.frames.length>10)throw fail('Instagram carousels need 2–10 slides.');
 if(item.status!=='approved'||!item.frames.every(frame=>frame.assetId))throw fail('Approve all carousel artwork before publishing or scheduling.');
 if(item.published&&!saved)throw fail('This carousel is already marked as published.');
 if(saved&&saved.revision!==item.revision)throw fail('This content changed after being sent. Review its existing post in PostPilot.');
 const scheduledFor=action==='schedule'?new Date(input.scheduledFor):null;
 if(action==='schedule'&&(!input.scheduledFor||!Number.isFinite(scheduledFor.getTime())||scheduledFor.getTime()<=Date.now()))throw fail('Choose a future schedule time.',400);
 const ready=await connection.readiness(action==='schedule');
 if(action==='retry'){
  if(!saved?.post_id||saved.status!=='failed')throw fail('Only a failed PostPilot publication can be retried.');
  const result=await connection.request(`/api/posts/${saved.post_id}/retry`,{method:'POST',body:{}});await update(result.status,result);return {...view(),account:ready.account};
 }
 if(saved?.post_id){
  const remote=await connection.request(`/api/posts/${saved.post_id}`);
  if(remote.status!=='draft'){await update(remote.status,remote);return {...view(),account:ready.account};}
 }else{
  if(saved&&saved.status!=='upload_failed')throw fail('A send is in progress or needs review in PostPilot. Do not create another post.');
  if(saved)await run("DELETE FROM v4_postpilot WHERE account_id=? AND content_id=? AND status='upload_failed'",account,item.id);
  const snapshot={knowledgeCardId:item.knowledge_card_id,angleId:item.angle_id,recipeId:item.recipe_id,region:clinic.profile.location||'',topic:item.topic};
  const locked=await run("INSERT OR IGNORE INTO v4_postpilot(account_id,content_id,revision,status,payload_json,updated_at) VALUES(?,?,?,'uploading',?,?)",account,item.id,item.revision,JSON.stringify(snapshot),new Date().toISOString());
  if(!locked.meta.changes)throw fail('This carousel is already being sent.');
  let payload;
  try{
   const media=[];
   for(const frame of [...item.frames].sort((a,b)=>a.position-b.position)){
    const asset=await first('SELECT original_key,mime FROM v4_assets WHERE account_id=? AND clinic_id=? AND id=?',account,clinic.id,frame.assetId);
    const image=asset&&await platform.readImage(asset.original_key);if(!image)throw fail('A carousel image is unavailable.');
    media.push((await connection.upload({...image,mime:asset.mime},`slide-${frame.position}.${asset.mime==='image/jpeg'?'jpg':asset.mime==='image/webp'?'webp':'png'}`)).id);
   }
   payload={title:(item.topic||'Clinic carousel').slice(0,100),caption:item.caption||'',mediaId:media[0],carouselMediaIds:media.slice(1),platforms:['instagram'],action:'draft'};
  }catch(error){await update('upload_failed',{},'Image upload failed. You can try again.');throw error;}
  // A timeout at draft creation may still have created the post: block repeat creation.
  await update('review',{},'Draft creation needs review if the request does not finish. Check PostPilot before sending again.');
  const draft=await connection.request('/api/posts',{method:'POST',body:payload});
  await run("UPDATE v4_postpilot SET post_id=?,status='draft',payload_json=?,error=NULL,updated_at=? WHERE account_id=? AND content_id=?",draft.id,JSON.stringify({...snapshot,post:payload}),new Date().toISOString(),account,item.id);
  saved=await first('SELECT * FROM v4_postpilot WHERE account_id=? AND content_id=?',account,item.id);
 }
 let result;
 if(action==='schedule')result=await connection.request(`/api/posts/${saved.post_id}`,{method:'PUT',body:{...JSON.parse(saved.payload_json).post,action:'schedule',scheduledFor:scheduledFor.toISOString()}});
 else result=await connection.request(`/api/posts/${saved.post_id}/publish`,{method:'POST',body:{}});
 await update(result.status,result);return {...view(),account:ready.account};
}
