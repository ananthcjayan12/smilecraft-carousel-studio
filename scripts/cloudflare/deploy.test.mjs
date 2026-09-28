import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { deploy, providerSecrets } from './deploy.mjs';

test('deployment uploads only owner AI keys through a private temporary file', async () => {
  const env = { OPENAI_API_KEY: 'openai-test-secret', GEMINI_API_KEY: 'gemini-test-secret', CLOUDFLARE_API_TOKEN: 'deploy-token' };
  assert.deepEqual(providerSecrets(env), { OPENAI_API_KEY: env.OPENAI_API_KEY, GEMINI_API_KEY: env.GEMINI_API_KEY });
  let secretFile;
  await deploy(env, (_program, args) => {
    assert.deepEqual(args.slice(0, 5), ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.generated.json']);
    secretFile = args.at(-1);
    assert.equal(args.at(-2), '--secrets-file');
    assert.deepEqual(JSON.parse(readFileSync(secretFile, 'utf8')), { OPENAI_API_KEY: env.OPENAI_API_KEY, GEMINI_API_KEY: env.GEMINI_API_KEY });
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    return { status: 0 };
  });
  assert.equal(existsSync(secretFile), false);
});

test('bootstrap can deploy before AI keys are supplied', async () => {
  await deploy({}, (_program, args) => {
    assert.equal(args.includes('--secrets-file'), false);
    return { status: 0 };
  });
});
