import { DENTAL_CONTENT_CARDS, CONTENT_CARD_VERSION } from '../server/v4-content-cards.mjs';
import { getClient } from './studio.mjs';

const now = () => new Date().toISOString();
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

function safeWebsite(value) {
  const raw = clean(value, 500);
  if (!raw) throw fail('Add the clinic website.');
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw fail('Enter a valid clinic website.'); }
  if (url.protocol !== 'https:') throw fail('Clinic websites must use HTTPS.');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host === '::1') throw fail('That website cannot be analysed.');
  return url;
}

const strip = value => clean(String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' '), 8000);
const attr = (tag, name) => {
  const expression = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*=\\s*(?:\\\"([^\\\"]*)\\\"|'([^']*)'|([^\\s>]+))", "i");
  const match = tag.match(expression);
  return match ? clean(match[1] || match[2] || match[3], 1200) : '';
};
const meta = (html, key) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (name === key.toLowerCase()) return attr(tag, 'content');
  }
  return '';
};
const linkRel = (html, re) => {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) if (re.test(attr(tag, 'rel'))) return attr(tag, 'href');
  return '';
};
function imageFromHtml(html) {
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = attr(tag, 'alt'), cls = attr(tag, 'class'), id = attr(tag, 'id');
    if (/logo|brand/i.test(`${alt} ${cls} ${id}`)) return attr(tag, 'src') || attr(tag, 'data-src');
  }
  return meta(html, 'og:image') || linkRel(html, /apple-touch-icon/i) || linkRel(html, /icon/i);
}
function servicesFromText(text) {
  const terms = [
    ['invisalign', 'Invisalign / clear aligners'],
    ['clear aligner', 'Clear aligners'],
    ['veneer', 'Veneers'],
    ['implant', 'Dental implants'],
    ['whitening', 'Teeth whitening'],
    ['root canal', 'Root canal treatment'],
    ['wisdom tooth', 'Wisdom tooth care'],
    ['wisdom teeth', 'Wisdom tooth care'],
    ['pediatric', 'Pediatric dentistry'],
    ['paediatric', 'Pediatric dentistry'],
    ['orthodont', 'Orthodontics'],
    ['emergency', 'Emergency dentistry'],
    ['dentur', 'Dentures'],
    ['crown', 'Crowns and bridges'],
    ['bridge', 'Crowns and bridges'],
    ['cleaning', 'Dental cleaning'],
    ['scaling', 'Dental cleaning'],
    ['gum', 'Gum care'],
    ['general dentistry', 'General dentistry'],
    ['cosmetic', 'Cosmetic dentistry']
  ];
  const lower = text.toLowerCase(), found = [];
  for (const [needle, label] of terms) if (lower.includes(needle) && !found.includes(label)) found.push(label);
  return found.slice(0, 10);
}
async function fetchLogoData(html, website) {
  const source = imageFromHtml(html);
  if (!source || /^data:/i.test(source)) return '';
  let url;
  try { url = new URL(source, website).href; } catch { return ''; }
  if (!url.startsWith('https://')) return '';
  try {
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'SrshtiClinicAnalyzer/1.0' } });
    if (!response.ok) return '';
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png','image/jpeg','image/webp'].includes(mime)) return '';
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 3_000_000) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 3_000_000) return '';
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8190) binary += String.fromCharCode(...bytes.slice(i, i + 8190));
    return `data:${mime};base64,${btoa(binary)}`;
  } catch { return ''; }
}
async function analyzeClinic(input) {
  const website = safeWebsite(input.website);
  let response;
  try {
    response = await fetch(website.href, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SrshtiClinicAnalyzer/1.0)', Accept: 'text/html,application/xhtml+xml' } });
  } catch { throw fail('We could not reach that website. You can still enter clinic details manually.', 422); }
  if (!response.ok) throw fail('We could not read that website. You can still enter clinic details manually.', 422);
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('text/html')) throw fail('That URL does not look like a clinic website.', 422);
  const html = (await response.text()).slice(0, 1_200_000);
  const plain = strip(html).slice(0, 180_000);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const siteName = meta(html, 'og:site_name');
  const title = strip(titleMatch?.[1] || '');
  const rawName = siteName || title.split(/\s+[|–—-]\s+/)[0] || website.hostname.replace(/^www\./,'');
  const description = meta(html, 'description') || meta(html, 'og:description');
  const phoneMatch = html.match(/href\s*=\s*["']tel:([^"'?]+)["']/i);
  const phone = clean(phoneMatch?.[1]?.replace(/%20/g,' '), 60);
  const theme = meta(html, 'theme-color');
  const jsonLocation = [...html.matchAll(/"(?:addressLocality|streetAddress|addressRegion)"\s*:\s*"([^"]+)"/gi)].map(m => strip(m[1])).filter(Boolean);
  const location = [...new Set(jsonLocation)].slice(0, 3).join(', ');
  const services = servicesFromText(plain);
  return {
    website: response.url || website.href,
    instagram: clean(input.instagram, 300),
    name: clean(rawName, 100),
    description: clean(description, 600),
    phone,
    location,
    services,
    primary: /^#[0-9a-f]{6}$/i.test(theme) ? theme : '#5b5bd6',
    accent: '#14b8a6',
    logoImage: await fetchLogoData(html, response.url || website.href)
  };
}

function weekKey(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? new Date(`${value}T00:00:00Z`) : new Date();
  if (Number.isNaN(date.valueOf())) throw fail('Invalid week date.');
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0,10);
}
function hash(value) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return (n >>> 0) / 4294967295;
}
function profileText(client) {
  return JSON.stringify({ ...client.profile, ...client.brand }).toLowerCase();
}
function desiredPillar(format, index) {
  if (format === 'carousel') return index === 0 ? ['education','myth','treatment'] : ['treatment','faq','education'];
  if (format === 'post') return ['trust','action','treatment'];
  return ['faq','prevention','myth','education','trust'];
}
function candidateCombos(client, recent, selected, format, slot, week) {
  const text = profileText(client), pillars = desiredPillar(format, slot);
  const selectedCards = new Set(selected.map(x => x.cardId));
  const clientCutoff = Date.now() - 70 * 86400000, globalCutoff = Date.now() - 14 * 86400000;
  const combos = [];
  for (const card of DENTAL_CONTENT_CARDS) {
    if (selectedCards.has(card.id)) continue;
    const clientRecentlyUsed = recent.some(r => r.client_id === client.id && r.card_id === card.id && Date.parse(r.created_at) > clientCutoff);
    if (clientRecentlyUsed) continue;
    for (const [angleKey, angle] of card.angles) {
      const globallyRecent = recent.some(r => r.card_id === card.id && r.angle_key === angleKey && Date.parse(r.created_at) > globalCutoff);
      let score = card.engagement + (pillars.includes(card.pillar) ? 16 : 0);
      if (card.services.some(s => text.includes(s.toLowerCase()) || s.toLowerCase().split(' ').some(w => w.length > 5 && text.includes(w)))) score += 22;
      if (globallyRecent) score -= 60;
      score += hash(`${client.id}|${week}|${format}|${slot}|${card.id}|${angleKey}`) * 13;
      combos.push({ card, angleKey, angle, score });
    }
  }
  return combos.sort((a,b) => b.score - a.score);
}
function planItem(combo, format, index) {
  const card = combo.card;
  return {
    id: `${format}-${index + 1}`,
    type: format,
    cardId: card.id,
    pillar: card.pillar,
    topic: card.topic,
    angleKey: combo.angleKey,
    angle: combo.angle,
    engagement: card.engagement,
    facts: card.facts,
    avoid: card.avoid,
    status: 'planned',
    approved: false,
    projectId: '',
    scheduledAt: ''
  };
}
async function currentRecent(env) {
  return (await env.DB.prepare("SELECT client_id,card_id,angle_key,format,created_at FROM v4_content_usage WHERE datetime(created_at) > datetime('now','-120 days')").all()).results;
}
async function choosePlan(env, client, week) {
  const recent = await currentRecent(env), selected = [], formats = ['carousel','carousel','post','story','story','story','story'];
  for (let i = 0; i < formats.length; i++) {
    const format = formats[i], combos = candidateCombos(client, recent, selected, format, i, week);
    const combo = combos[0] || (() => { const card = DENTAL_CONTENT_CARDS[i % DENTAL_CONTENT_CARDS.length]; return { card, angleKey: card.angles[0][0], angle: card.angles[0][1] }; })();
    selected.push(planItem(combo, format, i));
  }
  return {
    schemaVersion: 1,
    weekStart: week,
    cardVersion: CONTENT_CARD_VERSION,
    mix: { carousels: 2, posts: 1, stories: 4 },
    items: selected,
    status: 'planned'
  };
}
async function writePlan(env, accountId, client, week, plan, replace = false) {
  const stamp = now(), id = crypto.randomUUID();
  if (replace) await env.DB.prepare('DELETE FROM v4_content_usage WHERE account_id=? AND client_id=? AND week_start=?').bind(accountId, client.id, week).run();
  await env.DB.prepare(`INSERT INTO v4_weekly_plans(id,account_id,client_id,week_start,status,plan_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,client_id,week_start) DO UPDATE SET status=excluded.status,plan_json=excluded.plan_json,updated_at=excluded.updated_at`)
    .bind(id, accountId, client.id, week, plan.status || 'planned', JSON.stringify(plan), stamp, stamp).run();
  for (const item of plan.items) await env.DB.prepare('INSERT INTO v4_content_usage(id,account_id,client_id,card_id,angle_key,format,week_start,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), accountId, client.id, item.cardId, item.angleKey, item.type, week, stamp).run();
}
async function readPlan(env, accountId, clientId, week) {
  const row = await env.DB.prepare('SELECT plan_json,status,updated_at FROM v4_weekly_plans WHERE account_id=? AND client_id=? AND week_start=?').bind(accountId, clientId, week).first();
  return row ? { ...parse(row.plan_json, {}), status: row.status || parse(row.plan_json, {}).status, updatedAt: row.updated_at } : null;
}
async function grantTrial(env, accountId) {
  const source = 'v4-founder-trial';
  const existing = await env.DB.prepare('SELECT 1 x FROM credit_ledger WHERE account_id=? AND source_id=? LIMIT 1').bind(accountId, source).first();
  if (existing) return false;
  await env.DB.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES(?,?,250,'v4_trial',?)").bind(crypto.randomUUID(), accountId, source).run();
  return true;
}

export async function v4Route(request, env, viewer, url) {
  const accountId = viewer.account_id, method = request.method;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const body = async () => {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Expected a JSON object.');
    return value;
  };

  if (url.pathname === '/api/v4/bootstrap' && method === 'GET') {
    const trialGranted = await grantTrial(env, accountId);
    const clients = (await env.DB.prepare("SELECT * FROM clients WHERE account_id=? AND archived=0 ORDER BY updated_at DESC").bind(accountId).all()).results
      .map(row => ({ id: row.id, name: row.name, businessPackId: row.business_pack_id, revision: row.revision, profile: parse(row.profile_json), brand: parse(row.brand_json), updatedAt: row.updated_at }));
    const latest = clients[0] ? await env.DB.prepare('SELECT week_start,plan_json,status,updated_at FROM v4_weekly_plans WHERE account_id=? AND client_id=? ORDER BY week_start DESC LIMIT 1').bind(accountId, clients[0].id).first() : null;
    return json({ clients, trialGranted, contentCardVersion: CONTENT_CARD_VERSION, contentCardCount: DENTAL_CONTENT_CARDS.length, latestPlan: latest ? { ...parse(latest.plan_json), status: latest.status, updatedAt: latest.updated_at } : null });
  }

  if (url.pathname === '/api/v4/analyze-clinic' && method === 'POST') return json({ analysis: await analyzeClinic(await body()) });

  if (parts[0] !== 'api' || parts[1] !== 'v4' || parts[2] !== 'clients' || !parts[3]) throw fail('V4 route not found.', 404);
  const client = await getClient(env, accountId, parts[3]);
  if (!client) throw fail('Clinic not found.', 404);
  const week = weekKey(url.searchParams.get('week'));

  if (parts[4] === 'plan' && parts.length === 5 && method === 'GET') return json({ plan: await readPlan(env, accountId, client.id, week) });
  if (parts[4] === 'plan' && parts.length === 5 && method === 'POST') {
    const input = await body(), targetWeek = weekKey(input.weekStart || week);
    const existing = await readPlan(env, accountId, client.id, targetWeek);
    if (existing && !input.regenerate) return json({ plan: existing });
    const plan = await choosePlan(env, client, targetWeek);
    await writePlan(env, accountId, client, targetWeek, plan, Boolean(existing));
    return json({ plan });
  }
  if (parts[4] === 'plan' && parts.length === 5 && method === 'PATCH') {
    const input = await body(), targetWeek = weekKey(input.weekStart || week);
    const plan = await readPlan(env, accountId, client.id, targetWeek);
    if (!plan) throw fail('Create the week plan first.', 404);
    const item = plan.items?.find(x => x.id === input.itemId);
    if (!item) throw fail('Content item not found.', 404);
    const allowed = ['status','approved','projectId','scheduledAt'];
    for (const key of allowed) if (key in input) item[key] = key === 'approved' ? Boolean(input[key]) : clean(input[key], 200);
    plan.status = plan.items.every(x => x.approved) ? 'approved' : 'in_review';
    await env.DB.prepare('UPDATE v4_weekly_plans SET status=?,plan_json=?,updated_at=? WHERE account_id=? AND client_id=? AND week_start=?')
      .bind(plan.status, JSON.stringify(plan), now(), accountId, client.id, targetWeek).run();
    return json({ plan });
  }
  if (parts[4] === 'plan' && parts[5] === 'replace' && method === 'POST') {
    const input = await body(), targetWeek = weekKey(input.weekStart || week), plan = await readPlan(env, accountId, client.id, targetWeek);
    if (!plan) throw fail('Create the week plan first.', 404);
    const index = plan.items.findIndex(x => x.id === input.itemId);
    if (index < 0) throw fail('Content item not found.', 404);
    const old = plan.items[index], recent = await currentRecent(env);
    const remaining = plan.items.filter((_,i) => i !== index);
    const combos = candidateCombos(client, recent, remaining, old.type, index, targetWeek).filter(x => x.card.id !== old.cardId || x.angleKey !== old.angleKey);
    const combo = combos[0];
    if (!combo) throw fail('No fresh replacement is available right now.', 409);
    plan.items[index] = planItem(combo, old.type, index);
    await env.DB.prepare('DELETE FROM v4_content_usage WHERE account_id=? AND client_id=? AND week_start=? AND card_id=? AND angle_key=? AND format=?')
      .bind(accountId, client.id, targetWeek, old.cardId, old.angleKey, old.type).run();
    await env.DB.prepare('INSERT INTO v4_content_usage(id,account_id,client_id,card_id,angle_key,format,week_start,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), accountId, client.id, combo.card.id, combo.angleKey, old.type, targetWeek, now()).run();
    await env.DB.prepare('UPDATE v4_weekly_plans SET status=?,plan_json=?,updated_at=? WHERE account_id=? AND client_id=? AND week_start=?')
      .bind('planned', JSON.stringify(plan), now(), accountId, client.id, targetWeek).run();
    return json({ plan });
  }
  throw fail('V4 route not found.', 404);
}
