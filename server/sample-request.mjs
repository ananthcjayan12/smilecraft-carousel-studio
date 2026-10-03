// Free-carousel requests: validated here, then appended to the Google Sheet through its Apps Script web app.
// Shared by the Cloudflare Worker and the local server; needs SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
// A cell starting with = + - @ would run as a formula in Sheets.
const cell = value => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export function instagramHandle(value) {
  const raw = clean(value, 300);
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/i.exec(raw);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : '';
}

export function sampleRow(input, now = new Date()) {
  const name = clean(input.name, 120), clinic = clean(input.clinic, 160), email = clean(input.email, 254).toLowerCase();
  const instagram = instagramHandle(input.instagram);
  if (!name) throw fail('Please enter your name.');
  if (!clinic) throw fail('Please enter your clinic name.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) throw fail('Please enter a valid email address.');
  if (!instagram) throw fail('Please enter your clinic’s Instagram handle, for example @yourclinic.');
  const utm = input.utm && typeof input.utm === 'object' ? input.utm : {};
  // The handle is already restricted to letters, digits, dots and underscores, so its leading @ is safe.
  return [now.toISOString(), cell(name), cell(clinic), cell(email), instagram, ...['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].map(k => cell(clean(utm[k], 200))), 'New'];
}

export async function sampleRequestRoute(request, url, { env = {}, fetcher = fetch, now } = {}) {
  if (url.pathname !== '/api/public/sample-request') return null;
  const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (request.method !== 'POST') return reply({ error: 'Not found.' }, 404);
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== url.host) return reply({ error: 'Cross-site requests are not accepted.' }, 403);
    const input = await request.json().catch(() => { throw fail('Send the request as JSON.'); });
    if (clean(input.company, 100)) return reply({ ok: true }); // honeypot: bots fill hidden fields
    const row = sampleRow(input, now ? new Date(now()) : new Date());
    if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_SECRET) throw fail('Requests are not being accepted online yet. Please email hello@srshti.co.in.', 503);
    const response = await fetcher(env.SHEETS_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: env.SHEETS_WEBHOOK_SECRET, row }), redirect: 'follow' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) { console.error('Sheet append failed', response.status, result); throw fail('We could not save your request. Please try again or email hello@srshti.co.in.', 502); }
    return reply({ ok: true }, 201);
  } catch (error) {
    return reply({ error: error.status && error.status < 600 ? error.message : 'We could not save your request. Please try again.' }, error.status || 500);
  }
}
