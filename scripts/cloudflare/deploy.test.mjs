import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { deploy, providerSecrets } from './deploy.mjs';

test('deployment uploads owner AI and OAuth secrets through a private temporary file', async () => {
  const env = { OPENAI_API_KEY: 'openai-test-secret', GEMINI_API_KEY: 'gemini-test-secret', GOOGLE_CLIENT_ID: 'oauth-client-id', GOOGLE_CLIENT_SECRET: 'oauth-client-secret', CLOUDFLARE_API_TOKEN: 'deploy-token' };
  assert.deepEqual(providerSecrets(env), { OPENAI_API_KEY: env.OPENAI_API_KEY, GEMINI_API_KEY: env.GEMINI_API_KEY, GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET, DEMO_LOGIN: 'off', DEMO_PASSWORD: 'any' });
  let secretFile;
  await deploy(env, (_program, args) => {
    assert.deepEqual(args.slice(0, 5), ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.generated.json']);
    secretFile = args.at(-1);
    assert.equal(args.at(-2), '--secrets-file');
    assert.deepEqual(JSON.parse(readFileSync(secretFile, 'utf8')), { OPENAI_API_KEY: env.OPENAI_API_KEY, GEMINI_API_KEY: env.GEMINI_API_KEY, GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET, DEMO_LOGIN: 'off', DEMO_PASSWORD: 'any' });
    assert.equal(statSync(secretFile).mode & 0o777, 0o600);
    return { status: 0 };
  });
  assert.equal(existsSync(secretFile), false);
});

test('cloud app can deploy before owner secrets are supplied, with demo sign-in off', async () => {
  await deploy({}, (_program, args) => {
    assert.deepEqual(JSON.parse(readFileSync(args.at(-1), 'utf8')), { DEMO_LOGIN: 'off', DEMO_PASSWORD: 'any' });
    return { status: 0 };
  });
});

test('demo sign-in is enabled only by an explicit on value', () => {
  assert.deepEqual(providerSecrets({ DEMO_LOGIN: 'on', DEMO_PASSWORD: 'smile2026' }), { DEMO_LOGIN: 'on', DEMO_PASSWORD: 'smile2026' });
  assert.equal(providerSecrets({ DEMO_LOGIN: 'yes' }).DEMO_LOGIN, 'off');
});
