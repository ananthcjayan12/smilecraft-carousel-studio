import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleRequestRoute,sampleRow,instagramHandle} from '../server/sample-request.mjs';

const env={SHEETS_WEBHOOK_URL:'https://script.google.com/macros/s/test/exec',SHEETS_WEBHOOK_SECRET:'s3cret'};
const valid={name:'Dr Jane Lee',clinic:'River Dental',email:'Jane@RiverDental.com',instagram:'@riverdental',utm:{utm_source:'chatgpt',utm_campaign:'launch'}};
const call=(body,{fetcher,environment=env,headers={}}={})=>{const url=new URL('https://studio.test/api/public/sample-request');return sampleRequestRoute(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),url,{env:environment,fetcher,now:()=>Date.parse('2026-10-03T10:00:00Z')});};

test('Instagram handles are normalised from handles and profile URLs',()=>{
  assert.equal(instagramHandle('riverdental'),'@riverdental');
  assert.equal(instagramHandle('@river.dental_'),'@river.dental_');
  assert.equal(instagramHandle('https://www.instagram.com/riverdental/?hl=en'),'@riverdental');
  for(const bad of ['','@','river dental','https://evil.test/riverdental','=HYPERLINK("x")'])assert.equal(instagramHandle(bad),'');
});

test('rows match the sheet columns and neutralise spreadsheet formulas',()=>{
  const row=sampleRow({...valid,name:'=IMPORTXML("https://evil.test")',clinic:'+River'},new Date('2026-10-03T10:00:00Z'));
  assert.deepEqual(row,['2026-10-03T10:00:00.000Z','\'=IMPORTXML("https://evil.test")','\'+River','jane@riverdental.com','@riverdental','chatgpt','','launch','','New']);
});

test('valid requests are appended to the sheet with the shared secret',async()=>{
  let sent;
  const response=await call(valid,{fetcher:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({ok:true})}});
  assert.equal(response.status,201);
  assert.equal(sent.url,env.SHEETS_WEBHOOK_URL);
  assert.equal(sent.body.secret,'s3cret');
  assert.equal(sent.body.row[1],'Dr Jane Lee');
});

test('invalid, cross-site, bot and unconfigured requests never reach the sheet',async()=>{
  const fetcher=async()=>assert.fail('sheet must not be called');
  assert.equal((await call({...valid,instagram:''},{fetcher})).status,400);
  assert.equal((await call({...valid,email:'not-an-email'},{fetcher})).status,400);
  assert.equal((await call(valid,{fetcher,headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await call({...valid,company:'Spam Inc'},{fetcher})).status,200);
  assert.equal((await call(valid,{fetcher,environment:{}})).status,503);
});

test('sheet failures are reported to the visitor instead of looking successful',async()=>{
  const response=await call(valid,{fetcher:async()=>Response.json({ok:false,error:'unauthorised'})});
  assert.equal(response.status,502);
  assert.match((await response.json()).error,/could not save/);
});
