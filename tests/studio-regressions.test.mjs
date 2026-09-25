import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repairGeneration, friendlyGenerationError } from '../web/studio-controls.js';
import { generateSlideImage } from '../server/image-providers.mjs';

test('saved provider/model mismatches are repaired without changing valid selections', () => {
  assert.equal(repairGeneration({ provider: 'codex', model: 'gpt-image-2' }).model, 'gpt-5.6-sol');
  assert.equal(repairGeneration({ provider: 'gemini', model: 'gpt-image-2' }).model, 'gemini-3.1-flash-image');
  assert.equal(repairGeneration({ provider: 'openai', model: 'gpt-5.6-sol' }).model, 'gpt-image-2');
  assert.equal(repairGeneration({ provider: 'codex', model: 'gpt-5.6-terra' }).model, 'gpt-5.6-terra');
  assert.equal(repairGeneration({ writingProvider: 'claude', writingModel: 'gpt-5.6-sol' }).writingModel, 'claude-sonnet-4-6');
});

test('Codex image adapter uses a Codex model and all three references with the v1 instructions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'carousel-codex-regression-'));
  const prior = process.env.CODEX_BIN;
  const capture = path.join(root, 'arguments.json');
  const binary = path.join(root, 'fake-codex');
  await writeFile(binary, '#!' + process.execPath + '\n' + `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const imageAt = args.indexOf('--image'), end = args.indexOf('--');
    const references = args.slice(imageAt + 1, end).map(file => fs.readFileSync(file).toString('base64'));
    fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, references, apiKey: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) }));
    fs.writeFileSync('final-slide.png', Buffer.alloc(12000, 1));
  `, { mode: 0o700 });
  process.env.CODEX_BIN = binary;
  try {
    const image = bytes => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
    const result = await generateSlideImage({ provider: 'codex', model: 'gpt-image-2', workDir: root,
      slideNumber: 1, slide: { approved: true, heading: 'Test', body: 'Approved copy' },
      referenceImage: image('crop'), masterReferenceImage: image('board'), logoImage: image('logo') });
    assert.match(result, /^data:image\/png;base64,/);
    const recorded = JSON.parse(await readFile(capture, 'utf8'));
    assert.equal(recorded.args[recorded.args.indexOf('--model') + 1], 'gpt-5.6-sol');
    assert.deepEqual(recorded.references.map(x => Buffer.from(x, 'base64').toString()), ['crop', 'board', 'logo']);
    assert.match(recorded.args.at(-1), /Use Codex built-in image generation/);
    assert.match(recorded.args.at(-1), /Do NOT call the OpenAI API manually/);
    assert.equal(recorded.apiKey, false);
  } finally {
    if (prior === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('provider errors show the actionable message instead of the echoed prompt', () => {
  assert.equal(friendlyGenerationError(new Error('prompt text ERROR: {"error":{"message":"Quota exceeded"}} Diagnostic log: /tmp/log')), 'Quota exceeded');
});
