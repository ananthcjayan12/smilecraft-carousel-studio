import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runConcurrent } from '../web/batch-runner.js';
import { providerConcurrency, textConcurrency, providerActivity, withProviderSlot } from '../server/provider-concurrency.mjs';

const imageProviders = ['openai', 'gemini', 'codex', 'antigravity'];
const textProviders = [...imageProviders, 'claude'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const provider of imageProviders) {
  test(provider + ' image pipeline actually overlaps independent slide generations', async () => {
    const count = providerConcurrency[provider];
    assert.equal(count, 5);
    const started = [], finished = [];
    let active = 0, peak = 0;
    const result = await runConcurrent([0, 1, 2, 3, 4], count, async index => {
      return withProviderSlot(provider, async () => {
        active++; peak = Math.max(peak, active);
        started.push(index);
        await sleep(20);
        finished.push(index);
        active--;
        return index;
      });
    });
    assert.equal(peak, 5);
    assert.equal(result.peak, 5);
    assert.deepEqual(started.sort(), [0, 1, 2, 3, 4]);
    assert.deepEqual(finished.sort(), [0, 1, 2, 3, 4]);
    assert.equal(result.results.filter(item => item.status === 'fulfilled').length, 5);
    assert.equal(providerActivity().openai.active, 0);
  });
}
for (const provider of textProviders) {
  test(provider + ' text provider permits parallel independent content jobs', async () => {
    const limit = textConcurrency[provider];
    assert.equal(limit, 5);
    let running = 0, max = 0;
    await Promise.all(Array.from({ length: 5 }, () =>
      withProviderSlot(provider, async () => {
        running++; max = Math.max(max, running);
        await sleep(15);
        running--;
      }, 'text')));
    assert.equal(max, 5);
    assert.equal(providerActivity('text')[provider].active, 0);
  });
}
test('provider queue exposes active, queued and peak; frees a slot on failure', async () => {
  const provider = 'openai';
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const tasks = Array.from({ length: 5 }, () => withProviderSlot(provider, () => blocked));
  const extra = withProviderSlot(provider, async () => { throw new Error('expected generation failure'); });
  const busy = providerActivity().openai;
  assert.equal(busy.active, 5);
  assert.equal(busy.queued, 1);
  release();
  await Promise.all(tasks);
  await assert.rejects(extra, /expected generation failure/);
  const idle = providerActivity().openai;
  assert.equal(idle.active, 0);
  assert.equal(idle.queued, 0);
  assert.ok(idle.peak >= 5);
});
test('a failed slide does not prevent other parallel slides from completing', async () => {
  const completed = [];
  const result = await runConcurrent([1, 2, 3, 4, 5], 5, async number => {
    if (number === 2) throw new Error('bad image');
    await sleep(5);
    completed.push(number);
    return number;
  });
  assert.equal(result.results[1].status, 'rejected');
  assert.deepEqual(completed.sort(), [1, 3, 4, 5]);
  assert.equal(result.completed, 5);
});
test('configured account or CLI capacity overrides are respected', () => {
  const script = "import { providerConcurrency, textConcurrency } from './server/provider-concurrency.mjs'; console.log(JSON.stringify([providerConcurrency.openai, providerConcurrency.codex, textConcurrency.claude]));";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, IMAGE_PARALLEL_OPENAI: '2', IMAGE_PARALLEL_CODEX: '3', TEXT_PARALLEL_CLAUDE: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), [2, 3, 1]);
});
