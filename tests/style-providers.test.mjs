import test from 'node:test';
import assert from 'node:assert/strict';
import {styleModels,styleProviders} from '../web/style-providers.js';
const devices=[{online:true,capabilities:{codex:{ready:true,imageModels:[{id:'imagegen',label:'Codex ImageGen'}]}}}];
test('style editing discovers the live companion models and respects account access',()=>{
 assert.deepEqual(styleModels('codex',devices),[['imagegen','Codex ImageGen']]);
 assert.equal(styleProviders({imageProviders:{}},true,devices)[0][0],'codex');
 assert.deepEqual(styleProviders({imageProviders:{}},false,devices),[]);
 assert.deepEqual(styleModels('codex',[{...devices[0],online:false}]),[]);
});
