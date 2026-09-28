import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBusinessContext } from '../server/business-packs.mjs';
import { buildCodexPrompt } from '../server/codex.mjs';
import { buildSlideImagePrompt } from '../server/image-providers.mjs';
import { buildV1WritingPrompt, buildV1ImagePrompt, buildV1StylePrompt } from '../cloudflare/prompts.mjs';

const contextSnapshot = resolveBusinessContext({
  businessPackId: 'dental', name: 'Clinic', profile: {}, brand: { name: 'Clinic' },
});
const referenceContext = { id: 'builtin:dental:neutral:1.0.0' };

test('hosted draft and rewrite prompts retain the v.a.1 wording and Malayalam script rules', () => {
  const base = { contextSnapshot, referenceContext, topic: 'Tooth care', notes: 'Keep it simple' };
  for (const task of ['draft', 'revise']) {
    const input = task === 'revise' ? { ...base, slide: { role: 'Hook', heading: 'Care', body: 'Advice' }, correction: 'Shorter' } : base;
    const prompt = buildV1WritingPrompt(task, input);
    assert.equal(prompt, buildCodexPrompt(task, input));
    assert.match(prompt, /Malayalam words must use Malayalam script; English words stay in Latin script/);
  }
});

test('hosted artwork prompt retains the v.a.1 approved-copy and script rules', () => {
  const input = { contextSnapshot, referenceContext, slideNumber: 2, slide: { role: 'Science', heading: 'പല്ല് care', body: 'നല്ല habits' }, correction: 'Brighter' };
  assert.equal(buildV1ImagePrompt(input), buildSlideImagePrompt(input));
  assert.match(buildV1ImagePrompt(input), /Do not translate, transliterate, rewrite, omit or add words/);
});

test('hosted style prompt uses the v.a.1 design-system instructions', () => {
  const prompt = buildV1StylePrompt({ design: { kind: 'clean editorial' }, brand: { name: 'Clinic', primary: '#073a42', accent: '#14ada9' }, businessType: 'Dental', language: 'Malayalam + English', languageNotes: 'Malayalam headlines', direction: 'Minimal' });
  assert.match(prompt, /senior brand and editorial designer/);
  assert.match(prompt, /LANGUAGE SYSTEM: "Malayalam \+ English"/);
  assert.match(prompt, /five separate 4:5 social carousel templates/);
});
