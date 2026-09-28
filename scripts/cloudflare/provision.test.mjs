import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provision } from './provision.mjs';

test('Cloudflare bootstrap creates D1, private R2 and both queues once', async () => {
  const previous = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'carousel-cf-'));
  const base = await readFile(join(previous, 'wrangler.json'), 'utf8');
  const env = { CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) };
  let database, bucket, publicBucket = false;
  const queues = new Map();
  const created = [];
  const fetcher = async (url, init) => {
    const pathname = new URL(url).pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, '');
    let result;
    if (pathname === '/d1/database' && init.method === 'GET') result = database ? [database] : [];
    else if (pathname === '/d1/database' && init.method === 'POST') { database = { name: 'carousel-studio-v3-db', uuid: 'db-id' }; result = database; created.push('db'); }
    else if (pathname === '/r2/buckets/carousel-studio-v3-assets') {
      if (!bucket) return Response.json({ success: false }, { status: 404 });
      result = bucket;
    } else if (pathname === '/r2/buckets' && init.method === 'POST') { bucket = { name: 'carousel-studio-v3-assets' }; result = bucket; created.push('bucket'); }
    else if (pathname.endsWith('/domains/managed')) result = { enabled: publicBucket };
    else if (pathname.endsWith('/domains/custom')) result = { domains: [] };
    else if (pathname === '/queues' && init.method === 'GET') result = [...queues.values()];
    else if (pathname === '/queues' && init.method === 'POST') {
      const body = JSON.parse(init.body); result = { queue_name: body.queue_name, queue_id: `id-${body.queue_name}` };
      queues.set(body.queue_name, result); created.push(body.queue_name);
    } else if (pathname === '/workers/subdomain') result = { subdomain: 'example' };
    else throw new Error(`Unexpected ${init.method} ${pathname}`);
    return Response.json({ success: true, result });
  };
  try {
    await writeFile(join(directory, 'wrangler.json'), base);
    process.chdir(directory);
    const first = await provision(env, fetcher);
    assert.deepEqual(first.created, { database: true, bucket: true, queue: true, deadQueue: true });
    assert.equal(created.length, 4);
    const config = JSON.parse(await readFile('wrangler.generated.json', 'utf8'));
    assert.equal(config.d1_databases[0].database_id, 'db-id');
    assert.equal(config.queues.consumers[0].dead_letter_queue, 'carousel-studio-v3-dead');
    assert.equal(config.vars.APP_ORIGIN, 'https://carousel-studio-v3.example.workers.dev');
    assert.equal(config.vars.CLOUDFLARE_API_TOKEN, undefined);
    const second = await provision(env, fetcher);
    assert.deepEqual(second.created, { database: false, bucket: false, queue: false, deadQueue: false });
    assert.equal(created.length, 4);
    publicBucket = true;
    await assert.rejects(() => provision(env, fetcher), /public access/);
  } finally {
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
