import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { cloudflare, ensureResource, validate } from './config.mjs';

export async function provision(env = process.env, fetcher = fetch) {
  const names = validate(env), cf = cloudflare(env, fetcher);
  const db = await ensureResource(async () => {
    const matches = [];
    for (let page = 1; ; page++) {
      const rows = await cf(`/d1/database?name=${encodeURIComponent(names.database)}&per_page=100&page=${page}`);
      matches.push(...rows.filter(row => row.name === names.database));
      if (rows.length < 100) break;
    }
    if (matches.length > 1) throw new Error('Ambiguous D1 database name.');
    return matches[0];
  }, () => cf('/d1/database', { method: 'POST', body: { name: names.database } }));
  const bucket = await ensureResource(
    () => cf(`/r2/buckets/${names.bucket}`, { allow404: true }),
    () => cf('/r2/buckets', { method: 'POST', body: { name: names.bucket, storageClass: 'Standard' } })
  );
  const managed = await cf(`/r2/buckets/${names.bucket}/domains/managed`);
  const custom = await cf(`/r2/buckets/${names.bucket}/domains/custom`);
  if (managed?.enabled || custom?.domains?.some(domain => domain.enabled !== false)) throw new Error('R2 bucket has public access. Use a private dedicated bucket.');
  async function findQueue(name) {
    for (let page = 1; ; page++) {
      const result = await cf(`/queues?per_page=100&page=${page}`);
      const rows = Array.isArray(result) ? result : result?.queues || [];
      const match = rows.find(row => row.queue_name === name);
      if (match) return match;
      if (rows.length < 100) return null;
    }
  }
  const queue = await ensureResource(() => findQueue(names.queue), () => cf('/queues', { method: 'POST', body: { queue_name: names.queue } }));
  const deadQueue = await ensureResource(() => findQueue(names.deadQueue), () => cf('/queues', { method: 'POST', body: { queue_name: names.deadQueue } }));
  let origin = env.APP_ORIGIN;
  if (!origin) {
    const subdomain = await cf('/workers/subdomain');
    if (!subdomain?.subdomain) throw new Error('Configure a workers.dev subdomain in Cloudflare first.');
    origin = `https://${names.worker}.${subdomain.subdomain}.workers.dev`;
  }
  const config = JSON.parse(await readFile('wrangler.json', 'utf8'));
  config.name = names.worker;
  config.account_id = env.CLOUDFLARE_ACCOUNT_ID;
  config.d1_databases[0].database_name = names.database;
  config.d1_databases[0].database_id = db.resource.uuid || db.resource.id;
  if (!config.d1_databases[0].database_id) throw new Error('D1 did not return a database ID.');
  config.r2_buckets[0].bucket_name = names.bucket;
  config.queues.producers[0].queue = names.queue;
  config.queues.consumers[0].queue = names.queue;
  config.queues.consumers[0].dead_letter_queue = names.deadQueue;
  config.vars = { APP_ORIGIN: origin, ADMIN_EMAIL: env.ADMIN_EMAIL || '' };
  if(env.SRSHTI_IMAGE_MODEL)config.vars.SRSHTI_IMAGE_MODEL=env.SRSHTI_IMAGE_MODEL;
  if (!new URL(origin).hostname.endsWith('.workers.dev')) config.routes = [{ pattern: new URL(origin).hostname, custom_domain: true }];
  await writeFile('wrangler.generated.json', JSON.stringify(config, null, 2) + '\n');
  const state = { ...names, origin, databaseId: config.d1_databases[0].database_id,
    created: { database: db.created, bucket: bucket.created, queue: queue.created, deadQueue: deadQueue.created } };
  await writeFile('.cloudflare-state.json', JSON.stringify(state, null, 2) + '\n');
  const summary = `\n### Carousel Studio v3 infrastructure\n\n- D1: ${names.database} (${db.created ? 'created' : 'reused'})\n- Private R2: ${names.bucket} (${bucket.created ? 'created' : 'reused'})\n- Job queue: ${names.queue} (${queue.created ? 'created' : 'reused'})\n- Dead-letter queue: ${names.deadQueue} (${deadQueue.created ? 'created' : 'reused'})\n- App URL: ${origin}\n`;
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return state;
}

if (process.argv[1]?.endsWith('/provision.mjs')) provision().catch(error => { console.error(error.message); process.exitCode = 1; });
