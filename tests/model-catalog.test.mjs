import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readCodexModels} from '../server/v4/providers.mjs';
import {compatibleModel,codexTextModelArgs,textModelSettings,WRITING_MODELS} from '../web/provider-models.js';
test('Codex catalog uses visible CLI models and their supported effort levels',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'model-catalog-'));
 try{
  await writeFile(join(directory,'models_cache.json'),JSON.stringify({models:[{slug:'gpt-test',display_name:'Test',visibility:'list',supported_reasoning_levels:[{effort:'low'},{effort:'max'}]},{slug:'hidden',visibility:'hide'}]}));
  const catalog=readCodexModels({CODEX_HOME:directory});
  assert.deepEqual(catalog.models,[['gpt-test','Test']]);
  assert.deepEqual(catalog.writingModels,[['gpt-test','Test'],['gpt-test::low','Test (low)'],['gpt-test::max','Test (max)']]);
  assert.deepEqual(codexTextModelArgs(catalog.writingModels[2][0]),['--model','gpt-test','-c','model_reasoning_effort="max"']);
  await writeFile(join(directory,'models_cache.json'),'invalid');assert.equal(readCodexModels({CODEX_HOME:directory}),null);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Default and older model selections preserve provider defaults',()=>{
 assert.equal(compatibleModel('codex','gpt-5.5','image'),'gpt-5.5');
 for(const provider of ['gemini','openai','codex'])assert.deepEqual(textModelSettings(provider,WRITING_MODELS[provider][0][0]),{model:WRITING_MODELS[provider][0][0]});
 assert.deepEqual(textModelSettings('antigravity','gemini-3.8-flash-low'),{model:'gemini-3.8-flash-low'});
 assert.deepEqual(textModelSettings('gemini','gemini-2.5-pro'),{model:'gemini-2.5-pro'});
});
