import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationRun } from '../web/generation-run.js';
import { runConcurrent } from '../web/batch-runner.js';

test('Stop cancels active jobs and jobs received after Stop, but not completed jobs', async () => {
  const cancelled = [];
  const run = createGenerationRun(async id => cancelled.push(id));
  await run.track('finished'); run.finish('finished');
  await run.track('running');
  await run.stop();
  await run.track('late-create-response');
  assert.deepEqual(cancelled, ['running', 'late-create-response']);
});

test('failed cancellation remains retryable', async () => {
  let calls = 0;
  const run = createGenerationRun(async () => { if (++calls === 1) throw Error('Offline'); });
  await run.track('running');
  await assert.rejects(run.stop(), /Click Stop again/);
  assert.equal(run.stopped, true);
  assert.equal(run.stopping, false);
  await run.stop();
  assert.equal(calls, 2);
});

test('Stop prevents the rest of a batch from being submitted', async () => {
  const run = createGenerationRun(async () => {}), submitted = [];
  await runConcurrent([0,1,2,3,4], 1, async id => {
    submitted.push(id);
    await run.track(id);
    await run.stop();
    run.finish(id);
  }, { shouldContinue: () => !run.stopped });
  assert.deepEqual(submitted, [0]);
});
