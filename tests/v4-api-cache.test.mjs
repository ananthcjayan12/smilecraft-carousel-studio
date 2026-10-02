import test from 'node:test';
import assert from 'node:assert/strict';
import {api,clearApiCache} from '../web/v4/api.js';
test('GETs are deduplicated, mutation invalidates cached data, and progress bypasses cache',async t=>{
 clearApiCache();let reads=0,value=1,release;
 const blocked=new Promise(resolve=>release=resolve);
 t.mock.method(globalThis,'fetch',async(url,{method})=>{if(method==='GET'){reads++;if(reads===1)await blocked;return Response.json({value});}value++;return Response.json({ok:true});});
 const first=api('/test'),second=api('/test');release();
 assert.deepEqual(await first,{value:1});assert.deepEqual(await second,{value:1});assert.equal(reads,1);
 const cached=await api('/test');cached.value=99;assert.equal((await api('/test')).value,1);
 await api('/test',{method:'PUT',body:{}});assert.equal((await api('/test')).value,2);assert.equal(reads,2);
 value=3;assert.equal((await api('/test',{cache:false})).value,3);assert.equal((await api('/test')).value,3);assert.equal(reads,3);
});
test('an old pending read cannot refill the cache after a mutation',async t=>{
 clearApiCache();let release,reads=0;const blocked=new Promise(resolve=>release=resolve);
 t.mock.method(globalThis,'fetch',async(url,{method})=>{if(method!=='GET')return Response.json({ok:true});if(++reads===1){await blocked;return Response.json({value:'old'});}return Response.json({value:'new'});});
 const stale=api('/race');await api('/race',{method:'PUT',body:{}});release();await stale;
 assert.equal((await api('/race')).value,'new');
});


test('overlapping progress reads share one fresh request while bypassing saved data',async t=>{
 clearApiCache();let reads=0,release;const blocked=new Promise(resolve=>release=resolve);
 t.mock.method(globalThis,'fetch',async()=>{if(++reads===2)await blocked;return Response.json({value:reads});});
 assert.equal((await api('/progress')).value,1);
 const first=api('/progress',{cache:false}),second=api('/progress',{cache:false});release();
 assert.equal((await first).value,2);assert.equal((await second).value,2);assert.equal(reads,2);
});
