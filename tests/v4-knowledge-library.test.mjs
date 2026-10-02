import test from 'node:test';
import assert from 'node:assert/strict';
import {KNOWLEDGE_CARDS,rankCards} from '../server/v4/knowledge.mjs';

test('CSV library retains 400 unique planning ideas and source review requirements',()=>{
 const imported=KNOWLEDGE_CARDS.filter(c=>c.id.startsWith('DENT-'));
 assert.equal(imported.length,400);
 assert.equal(new Set(KNOWLEDGE_CARDS.map(c=>c.id)).size,KNOWLEDGE_CARDS.length);
 assert.equal(new Set(imported.map(c=>c.topicClusterId)).size,80);
 assert.ok(imported.every(c=>c.sourceRequirement&&c.reviewStatus==='requires-source-review'&&!c.verifiedFacts.length));
});
test('Published topics never repeat across formats; other clinics remain eligible',()=>{
 const clinic={id:'one',profile:{services:[]}};
 const card=KNOWLEDGE_CARDS.find(c=>c.id==='DENT-001');
 const history=[{clinic_id:clinic.id,knowledge_card_id:card.id,status:'published',generated_at:'2020-01-01'}];
 for(const format of ['carousel','post','story']){
  assert.ok(rankCards(clinic,history,[],format).every(r=>r.card.topicClusterId!==card.topicClusterId));
  assert.ok(rankCards(clinic,[],[card.id],format).every(r=>r.card.topicClusterId!==card.topicClusterId));
 }
 assert.ok(rankCards({...clinic,id:'two'},history).some(r=>r.card.id===card.id));
 const exhausted=KNOWLEDGE_CARDS.map(c=>({clinic_id:clinic.id,knowledge_card_id:c.id,status:'published',generated_at:'2020-01-01'}));
 assert.equal(rankCards(clinic,exhausted).length,0);
});

test('Unpublished reservations expire and released topics are immediately reusable',()=>{
 const clinic={id:'one',profile:{services:[]}},card=KNOWLEDGE_CARDS.find(c=>c.id==='DENT-001'),now=Date.parse('2026-10-02');
 const row={clinic_id:clinic.id,knowledge_card_id:card.id,generated_at:'2026-10-01'};
 const eligible=h=>rankCards(clinic,[h],[],'carousel',now).some(r=>r.card.id===card.id);
 for(const status of ['planned','generated','approved']){assert.equal(eligible({...row,status}),false);assert.equal(eligible({...row,status,generated_at:'2026-09-01'}),true);}
 for(const status of ['rejected','skipped'])assert.equal(eligible({...row,status}),true);
});
