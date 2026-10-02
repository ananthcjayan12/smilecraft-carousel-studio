import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiStructured,assertSchema} from '../server/v4/text-api.mjs';
import {writingSchema,briefSchema,writingPrompt,artworkPrompt,sourceBrief,contentContext} from '../server/v4/content-prompts.mjs';
import {stylePrompt} from '../server/v4/image-prompts.mjs';
for(const provider of ['openai','gemini','claude'])test(`${provider} writing sends the reference image and structured schema`,async()=>{
 const schema=writingSchema('post'),draft={topic:'Topic',brief:'Brief',frames:[{heading:'Heading',body:'Body',visualPrompt:'Concept'}],caption:'Caption'};let request;
 const fetcher=async(url,options)=>{request={url,body:JSON.parse(options.body)};return Response.json(provider==='openai'?{choices:[{message:{content:JSON.stringify(draft)}}]}:provider==='gemini'?{candidates:[{content:{parts:[{text:JSON.stringify(draft)}]}}]}:{content:[{text:JSON.stringify(draft)}]});};
 assert.deepEqual(await apiStructured({provider,model:'test-model',schema,prompt:'Test reference copy',reference:{bytes:new Uint8Array([1,2,3]),mime:'image/png'},env:{OPENAI_API_KEY:'test',GEMINI_API_KEY:'test',ANTHROPIC_API_KEY:'test'},fetcher}),draft);
 if(provider==='openai'){assert.equal(request.body.messages[0].content[1].image_url.url,'data:image/png;base64,AQID');assert.deepEqual(request.body.response_format.json_schema.schema,schema);}
 if(provider==='gemini'){assert.equal(request.body.contents[0].parts[1].inlineData.data,'AQID');assert.deepEqual(request.body.generationConfig.responseJsonSchema,schema);}
 if(provider==='claude'){assert.equal(request.body.messages[0].content[0].source.data,'AQID');assert.deepEqual(request.body.output_config.format.schema,schema);}
});
test('Structured responses reject malformed objects and missing frame fields',()=>{assert.throws(()=>assertSchema({topic:'Topic'},briefSchema),/omitted summary/);assert.throws(()=>assertSchema({topic:'Topic',brief:'Brief',frames:[],caption:'Caption'},writingSchema('post')),/number of entries/);assert.throws(()=>assertSchema({topic:'Topic',summary:'Summary',unexpected:'value'},briefSchema),/unexpected fields/);});
test('V3 based prompts follow arbitrary language combinations and full approved copy without truncation',()=>{
 const clinic={name:'River Dental',brand:{phone:'+91 1234567890',primary:'#123456',accent:'#abcdef'},profile:{language:'Hindi + English',facts:[],services:[]}},brief=sourceBrief(null,null,clinic,{customBrief:'Sunday opening'}),item={type:'post',language:clinic.profile.language,brief,topic:'Opening'};item.context=contentContext(clinic,item);
 const frame={position:1,heading:'Sunday opening',body:'a'.repeat(400),visualPrompt:'Editorial clinic illustration',contacts:item.context.business.contacts};item.frames=[frame];
 const writing=writingPrompt(clinic,item,{name:'Clinical white'});assert.match(writing,/Hindi \+ English/);assert.doesNotMatch(writing,/Write clear natural English/);assert.match(writing,/exactly ONE complete post frame/);assert.doesNotMatch(writing,/exactly five coordinated slides/);const image=artworkPrompt(clinic,item,frame);assert.ok(image.includes('BODY: '+JSON.stringify(frame.body)));assert.match(image,/post frame 1 of 1/);assert.match(image,/1234567890/);assert.match(stylePrompt(clinic,'clinical-white'),/senior brand and editorial designer/);
});
