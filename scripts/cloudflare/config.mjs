export function validate(env) {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('Missing CLOUDFLARE_API_TOKEN.');
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || '')) throw new Error('CLOUDFLARE_ACCOUNT_ID must be 32 hex characters.');
  const worker = env.WORKER_NAME || 'carousel-studio-v4';
  const database = env.D1_DATABASE_NAME || `${worker}-db`;
  const bucket = env.R2_BUCKET_NAME || `${worker}-assets`;
  const queue = env.QUEUE_NAME || `${worker}-jobs`;
  const deadQueue = env.DEAD_QUEUE_NAME || `${worker}-dead`;
  for (const [kind, value] of Object.entries({ worker, database, bucket, queue, deadQueue })) {
    if (!/^[a-z][a-z0-9-]{2,50}$/.test(value)) throw new Error(`${kind} name must start with a letter and contain 3–51 lowercase letters, digits or hyphens.`);
  }
  if (new Set([database, bucket, queue, deadQueue]).size !== 4) throw new Error('Cloudflare resource names must be distinct.');
  if (env.APP_ORIGIN) {
    const url = new URL(env.APP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN) throw new Error('APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  }
  return { worker, database, bucket, queue, deadQueue };
}

export function cloudflare(env, fetcher = fetch) {
  return async (path, { method = 'GET', body, allow404 = false } = {}) => {
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (method !== 'GET' || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    if (response.status === 404 && allow404) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) throw new Error(`Cloudflare ${method} ${path.split('?')[0]} failed (${response.status}; codes ${(payload.errors || []).map(x => x.code).join(',')}).`);
    return payload.result;
  };
}

export async function ensureResource(find, create) {
  const existing = await find();
  if (existing) return { resource: existing, created: false };
  try { return { resource: await create(), created: true }; }
  catch (error) {
    const concurrent = await find();
    if (concurrent) return { resource: concurrent, created: false };
    throw error;
  }
}
