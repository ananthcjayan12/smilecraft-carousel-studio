// Free-carousel requests: validated here and saved to the sample_requests table, where the administrator reviews them.
// Shared by the Cloudflare Worker (D1) and the local server (SQLite behind the same prepare/bind interface).
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
export const LEAD_STATUSES = ['New', 'Contacted', 'Sample sent', 'Demo booked', 'Customer', 'Not a fit'];

export function instagramHandle(value) {
  const raw = clean(value, 300);
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/i.exec(raw);
  const handle = fromUrl ? fromUrl[1] : raw.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : '';
}

export function sampleLead(input, now = new Date()) {
  const name = clean(input.name, 120), clinic = clean(input.clinic, 160), email = clean(input.email, 254).toLowerCase();
  const instagram = instagramHandle(input.instagram);
  if (!name) throw fail('Please enter your name.');
  if (!clinic) throw fail('Please enter your clinic name.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) throw fail('Please enter a valid email address.');
  if (!instagram) throw fail('Please enter your clinic’s Instagram handle, for example @yourclinic.');
  const utm = input.utm && typeof input.utm === 'object' ? input.utm : {};
  return { createdAt: now.toISOString(), name, clinic, email, instagram, ...Object.fromEntries(UTM.map(k => [k, clean(utm[k], 200)])) };
}

export async function sampleRequestRoute(request, url, { db, now } = {}) {
  if (url.pathname !== '/api/public/sample-request') return null;
  const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (request.method !== 'POST') return reply({ error: 'Not found.' }, 404);
    const origin = request.headers.get('Origin');
    if (origin && new URL(origin).host !== url.host) return reply({ error: 'Cross-site requests are not accepted.' }, 403);
    const input = await request.json().catch(() => { throw fail('Send the request as JSON.'); });
    if (clean(input.company, 100)) return reply({ ok: true }); // honeypot: bots fill hidden fields
    const lead = sampleLead(input, now ? new Date(now()) : new Date());
    // A repeat of the same email and handle (a double submit or a second visit) keeps the original lead.
    await db.prepare(`INSERT INTO sample_requests(id,created_at,updated_at,name,clinic,email,instagram,utm_source,utm_medium,utm_campaign,utm_content)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sample_requests WHERE email=? AND instagram=?)`)
      .bind(crypto.randomUUID(), lead.createdAt, lead.createdAt, lead.name, lead.clinic, lead.email, lead.instagram, ...UTM.map(k => lead[k]), lead.email, lead.instagram).run();
    // The stored id doubles as the ad-measurement event id, so a repeat request is never counted as a second lead.
    const saved = await db.prepare('SELECT id FROM sample_requests WHERE email=? AND instagram=?').bind(lead.email, lead.instagram).first();
    return reply({ ok: true, id: saved?.id }, 201);
  } catch (error) {
    if (!error.status) console.error('Sample request failed', error);
    return reply({ error: error.status ? error.message : 'We could not save your request. Please try again or email hello@srshti.co.in.' }, error.status || 500);
  }
}

const LEAD_COLUMNS = 'id,created_at AS createdAt,updated_at AS updatedAt,name,clinic,email,instagram,utm_source AS utmSource,utm_medium AS utmMedium,utm_campaign AS utmCampaign,utm_content AS utmContent,status,notes';
// Administrator-only lead list and status/notes updates; the caller has already checked the viewer is the administrator.
export async function adminLeadsRoute(request, url, db) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'api' || parts[1] !== 'admin' || parts[2] !== 'leads') return null;
  if (parts.length === 3 && request.method === 'GET') {
    const { results } = await db.prepare(`SELECT ${LEAD_COLUMNS} FROM sample_requests ORDER BY created_at DESC LIMIT 1000`).bind().all();
    return Response.json({ leads: results, statuses: LEAD_STATUSES }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (parts.length === 4 && request.method === 'PATCH') {
    const input = await request.json().catch(() => ({})), changes = {};
    if (input.status !== undefined) { if (!LEAD_STATUSES.includes(input.status)) throw fail('Unknown lead status.'); changes.status = input.status; }
    if (input.notes !== undefined) changes.notes = String(input.notes).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 2000); // keeps line breaks
    if (!Object.keys(changes).length) throw fail('Nothing to update.');
    const keys = Object.keys(changes);
    const changed = await db.prepare(`UPDATE sample_requests SET ${keys.map(k => `${k}=?`).join(',')},updated_at=? WHERE id=?`).bind(...keys.map(k => changes[k]), new Date().toISOString(), parts[3]).run();
    if (!changed.meta.changes) throw fail('Lead not found.', 404);
    return Response.json({ lead: await db.prepare(`SELECT ${LEAD_COLUMNS} FROM sample_requests WHERE id=?`).bind(parts[3]).first() });
  }
  throw fail('Not found.', 404);
}
