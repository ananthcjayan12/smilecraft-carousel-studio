import {test} from 'node:test';
import assert from 'node:assert/strict';
import {artworkRatio,artworkApiSize,requireArtworkRatio} from '../server/v4/artwork-format.mjs';
test('content formats are requested natively and reject mismatched provider output',()=>{
 for(const [type,ratio,width,height] of [['carousel','4:5',1080,1350],['post','1:1',1080,1080],['story','9:16',1080,1920]]){
  assert.equal(artworkRatio(type),ratio);
  requireArtworkRatio({width,height},ratio);
  const [w,h]=artworkApiSize('gpt-image-2',ratio).split('x').map(Number);
  requireArtworkRatio({width:w,height:h},ratio);
  assert.throws(()=>requireArtworkRatio({width:1536,height:1024},ratio),/requires/);
 }
 assert.throws(()=>artworkApiSize('gpt-image-1','4:5'),/cannot generate/);
 assert.throws(()=>artworkApiSize('gpt-image-1','9:16'),/cannot generate/);
 assert.equal(artworkApiSize('gpt-image-1','1:1'),'1024x1024');
});
