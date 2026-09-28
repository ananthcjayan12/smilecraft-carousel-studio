import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const providerSecretNames = ['OPENAI_API_KEY', 'GEMINI_API_KEY'];
export function providerSecrets(env) {
  return Object.fromEntries(providerSecretNames.filter(name => env[name]).map(name => [name, env[name]]));
}

export async function deploy(env = process.env, run = spawnSync) {
  const secrets = providerSecrets(env);
  const directory = await mkdtemp(join(tmpdir(), 'carousel-worker-secrets-'));
  try {
    const file = join(directory, 'secrets.json');
    const args = ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.generated.json'];
    if (Object.keys(secrets).length) {
      await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
      args.push('--secrets-file', file);
    }
    const result = run('npx', args, { stdio: 'inherit', env });
    if (result.error || result.status !== 0) throw new Error('Cloudflare Worker deployment failed. Review Wrangler output.');
    console.log(`Worker deployed; ${Object.keys(secrets).length} provider secret value(s) uploaded in this run. Secret values were not printed.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('/deploy.mjs')) deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
