import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {apiStructured,parseStructured,assertSchema} from './text-api.mjs';
function command(binary,args,{cwd,input,signal}){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const child=spawn(binary,args,{cwd,env:{...process.env,CI:'1'},stdio:['pipe','pipe','pipe']});let out='',err='',done=false;
  const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(out);};
  const abort=()=>{child.kill('SIGTERM');finish(Error('Writing cancelled.'));};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(Error('Writing timed out. Retry this task.'));},600000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',v=>{out+=v;if(out.length>2000000){child.kill('SIGTERM');finish(Error('Provider response was too large.'));}});
  child.stderr.on('data',v=>{if(err.length<2000)err+=v});
  child.on('error',()=>finish(Error('The selected writing CLI could not start. Check Settings.')));
  child.on('close',code=>finish(code===0?null:Error(`Writing CLI exited ${code}. ${err.slice(-600)}`)));
  child.stdin.end(input||'');
 });
}
export async function localStructured(input){
 if(!['codex','antigravity'].includes(input.provider))return apiStructured({...input,env:process.env});
 const directory=await mkdtemp(join(tmpdir(),'srshti-writing-'));
 try{
  const schemaFile=join(directory,'schema.json'),output=join(directory,'result.json');await writeFile(schemaFile,JSON.stringify(input.schema));
  let image='';if(input.reference){image=join(directory,'template-reference.'+(input.reference.mime==='image/jpeg'?'jpg':input.reference.mime==='image/webp'?'webp':'png'));await writeFile(image,Buffer.from(input.reference.bytes));}
  let parsed;
  if(input.provider==='codex'){
   const args=['exec','--skip-git-repo-check','--sandbox','read-only','--ephemeral','--model',input.model,'--output-schema',schemaFile,'--output-last-message',output,...(image?['--image',image]:[]),'-'];
   const raw=await command(process.env.CODEX_BIN||'codex',args,{cwd:directory,input:input.prompt,signal:input.signal});parsed=parseStructured(await readFile(output,'utf8').catch(()=>raw));
  }else{
   const prompt=`Return only the JSON object matching the schema. Do not browse, run commands, inspect credentials or unrelated files. ${image?`Inspect ONLY the supplied design reference image at ${image} to guide layout and copy density. Read-only image inspection is the only permitted tool action.`:'Do not call tools.'}\n${input.prompt}`;
   const raw=await command(process.env.AGY_BIN||'agy',['--disable-slash-commands','--sandbox','--mode','plan','--output-format','json','--json-schema',JSON.stringify(input.schema),'--print-timeout','10m','--model',input.model,'-p',prompt],{cwd:directory,signal:input.signal});
   const result=parseStructured(raw);if(result.status!=='SUCCESS')throw Error('Antigravity did not complete the writing task.');parsed=parseStructured(result.structured_output??result.response);
  }
  return assertSchema(parsed,input.schema);
 }finally{await rm(directory,{recursive:true,force:true});}
}
