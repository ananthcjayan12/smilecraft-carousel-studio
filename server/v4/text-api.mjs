const b64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)};
export function parseStructured(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 const cleaned=String(value||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try{const result=JSON.parse(cleaned);if(result&&typeof result==='object'&&!Array.isArray(result))return result;}catch{}
 throw Error('The writing provider returned invalid JSON. Retry or select another model.');
}
export function assertSchema(value,schema){
 if(schema.type==='object'){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('The provider returned an invalid object.');for(const key of schema.required||[])if(!(key in value))throw Error(`The provider omitted ${key}.`);for(const [key,child] of Object.entries(schema.properties))if(key in value)assertSchema(value[key],child);if(schema.additionalProperties===false&&Object.keys(value).some(key=>!schema.properties[key]))throw Error('The provider returned unexpected fields.');}
 else if(schema.type==='array'){if(!Array.isArray(value)||value.length<(schema.minItems||0)||value.length>(schema.maxItems??Infinity))throw Error('The provider returned an invalid number of entries.');value.forEach(child=>assertSchema(child,schema.items));}
 else if(typeof value!==schema.type)throw Error(`The provider returned an invalid ${schema.type} field.`);
 return value;
}
export async function apiStructured({provider,model,prompt,schema,reference,signal,env,fetcher=fetch}){
 const timeout=AbortSignal.timeout(240000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
 const encoded=reference?b64(new Uint8Array(reference.bytes)):'';
 let url,body,headers={'Content-Type':'application/json'};
 if(provider==='openai'){
  if(!env.OPENAI_API_KEY)throw Error('OpenAI API is unavailable. Configure the server key or choose another provider.');
  url='https://api.openai.com/v1/chat/completions';headers.Authorization=`Bearer ${env.OPENAI_API_KEY}`;
  body={model,messages:[{role:'user',content:[{type:'text',text:prompt},...(reference?[{type:'image_url',image_url:{url:`data:${reference.mime};base64,${encoded}`}}]:[])]}],response_format:{type:'json_schema',json_schema:{name:'clinic_content',strict:true,schema}}};
 }else if(provider==='gemini'){
  if(!env.GEMINI_API_KEY)throw Error('Gemini API is unavailable. Configure the server key or choose another provider.');
  url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;headers['x-goog-api-key']=env.GEMINI_API_KEY;
  body={contents:[{parts:[{text:prompt},...(reference?[{inlineData:{mimeType:reference.mime,data:encoded}}]:[])]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema}};
 }else if(provider==='claude'){
  if(!env.ANTHROPIC_API_KEY)throw Error('Claude API is unavailable. Configure the server key or choose another provider.');
  url='https://api.anthropic.com/v1/messages';headers['x-api-key']=env.ANTHROPIC_API_KEY;headers['anthropic-version']='2023-06-01';
  body={model,max_tokens:6000,messages:[{role:'user',content:[...(reference?[{type:'image',source:{type:'base64',media_type:reference.mime,data:encoded}}]:[]),{type:'text',text:prompt}]}],output_config:{format:{type:'json_schema',schema}}};
 }else throw Error('Choose an available writing provider.');
 const response=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),signal:requestSignal});
 if(!response.ok)throw Error(`${provider} rejected the writing task (${response.status}). Check your provider/model settings and retry.`);
 const result=await response.json();
 const raw=provider==='openai'?result.choices?.[0]?.message?.content:provider==='gemini'?result.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''):result.content?.map(p=>p.text||'').join('');
 return assertSchema(parseStructured(raw),schema);
}
