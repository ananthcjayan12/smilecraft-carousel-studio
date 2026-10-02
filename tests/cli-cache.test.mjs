import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectCli} from '../server/cli-tools.mjs';
test('local startup reuses CLI discovery instead of running every command twice',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-cli-cache-')),binary=join(dir,'fake-cli'),count=join(dir,'count');
 await writeFile(binary,'#!'+process.execPath+'\n'+`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(count)},'call\\n');console.log('fake 1.0');`,{mode:0o700});
 const previous=process.env.TEST_CACHED_CLI;process.env.TEST_CACHED_CLI=binary;
 t.after(async()=>{if(previous===undefined)delete process.env.TEST_CACHED_CLI;else process.env.TEST_CACHED_CLI=previous;await rm(dir,{recursive:true,force:true});});
 const first=inspectCli('fake','TEST_CACHED_CLI',{authArgs:['login','status']});
 assert.equal(first.authenticated,true);assert.deepEqual(inspectCli('fake','TEST_CACHED_CLI',{authArgs:['login','status']}),first);
 assert.equal((await readFile(count,'utf8')).trim().split('\n').length,2);
 inspectCli('fake','TEST_CACHED_CLI',{authArgs:['login','status'],refresh:true});
 assert.equal((await readFile(count,'utf8')).trim().split('\n').length,4);
});
