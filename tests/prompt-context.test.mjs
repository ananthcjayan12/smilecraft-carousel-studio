import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBusinessContext, BUSINESS_PACKS } from '../server/business-packs.mjs';
import { selectedReferenceContext } from '../server/prompt-context.mjs';
import { buildCodexPrompt } from '../server/codex.mjs';
import { buildSlideImagePrompt } from '../server/image-providers.mjs';

for (const pack of BUSINESS_PACKS) test(`${pack.id}: drafting, rewriting and images use business and selected reference`, () => {
  const context = resolveBusinessContext({name:'Example Client',businessPackId:pack.id,profile:{services:'Supplied service',audience:'Local families',language:'english'},brand:{name:'Example Client',phone:'12345'}});
  const reference = selectedReferenceContext({id:'reference-a',name:'Selected reference A',packId:'examples',packVersion:'2.0.0',checksum:'abc',businessPackId:pack.id,mode:'board'},pack.id);
  const slide={role:pack.roles[1],heading:'Approved heading',body:'Approved copy',visualPrompt:'Supplied visual'};
  const draft=buildCodexPrompt('draft',{topic:'Our services',contextSnapshot:context,referenceContext:reference});
  const revise=buildCodexPrompt('revise',{slide,slideNumber:2,contextSnapshot:context,referenceContext:reference,correction:'Shorten'});
  const image=buildSlideImagePrompt({slide,slideNumber:2,contextSnapshot:context,referenceContext:reference,masterReferenceImage:'attached'});
  for(const prompt of [draft,revise,image]){
    assert.ok(prompt.includes(pack.name));
    assert.match(prompt,/Supplied service/);
    assert.match(prompt,/Local families/);
    assert.match(prompt,/Selected reference A/);
    assert.ok(prompt.includes(pack.promptRules[0]));
    if(pack.id!=='dental')assert.doesNotMatch(prompt,/dental|tooth|Book an Appointment/i);
  }
  assert.match(draft,/metadata, not the image pixels/);
  assert.match(image,/Inspect the attached reference images/);
  assert.match(image,/PHONE \(FINAL CTA ONLY\): ""/);
  const cta=buildSlideImagePrompt({slide,slideNumber:5,contextSnapshot:context,referenceContext:reference});
  assert.ok(cta.includes(context.cta.text));
  assert.match(cta,/12345/);
  const changed=buildCodexPrompt('draft',{contextSnapshot:context,referenceContext:{...reference,name:'Reference B'}});
  assert.match(changed,/Reference B/);
  assert.doesNotMatch(changed,/Selected reference A/);
});

test('incompatible references cannot supply another business context',()=>{
  assert.throws(()=>selectedReferenceContext({businessPackId:'dental'},'tour'),/does not match/);
});

test('dental client language and CTA override legacy defaults',()=>{
  const c=resolveBusinessContext({name:'Dental Example',businessPackId:'dental',profile:{language:'english',preferredAction:'Ask our team'},brand:{name:'Dental Example'}});
  const p=buildSlideImagePrompt({slideNumber:5,slide:{heading:'Hello',body:'Approved'},contextSnapshot:c});
  assert.match(p,/Ask our team/);
  assert.doesNotMatch(p,/Book an Appointment|Kerala/);
});
