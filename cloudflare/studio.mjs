import { imageFormat } from '../web/image-formats.js';
import { publicBusinessPacks, getBusinessPack, resolveBusinessContext, starterSlidesForPack } from '../server/business-packs.mjs';
import { repairGeneration } from '../web/studio-controls.js';
import { runJob, cancelJob } from './generation.mjs';
import { enqueueCompanion } from './companion.mjs';
import { templateImportRoute } from './template-import.mjs';
import { renderStyleBoard } from './style-maker.mjs';

const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const bad = (message, status = 400) => json({ error: message }, status);
const builtin = [
  ...['dental', 'tour', 'salon', 'construction', 'general'].map(id => ({ id: `builtin:${id}:neutral:1.0.0`, clientId: null, name: 'Modern Teal', businessPackId: id, mode: 'slides', data: { slides: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, staticPath: id === 'dental' ? '/assets/teal-editorial.jpg' : '/assets/neutral-starter.png' })) } })),
  ...[['friendly', 'Friendly Clinic', 'friendly-clinic.jpg'], ['clean', 'Clinical Clean', 'clinical-clean.jpg'], ['premium', 'Premium Dark', 'premium-dark.jpg']].map(([id, name, file]) => ({ id: `builtin:dental:${id}:1.0.0`, clientId: null, name, businessPackId: 'dental', mode: 'slides', data: { slides: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, staticPath: `/assets/${file}` })) } })),
  ...[['teal-editorial-pro', .205, .744], ['clinical-white', .205, .752], ['warm-ivory', .064, .811], ['deep-teal-premium', .181, .848], ['mint-friendly', .158, .864], ['airy-aqua', .160, .824], ['kids-mint', .177, .866], ['nature-sage', .172, .826], ['warm-clinical', .205, .915], ['premium-charcoal', .163, .736]].map(([id, top, bottom]) => ({ id: `builtin:dental:legacy:${id}:1.0.0`, clientId: null, name: id.replaceAll('-', ' '), businessPackId: 'dental', mode: 'board', data: { staticPath: `/assets/design-systems/${id}.png`, cropPaths: Array.from({ length: 5 }, (_, i) => `/assets/design-systems/crops/${id}-${i + 1}.jpg`), crops: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, top, bottom, left: .006, right: .006, gap: .005 })) } }))
];
export function builtinTemplate(id) { return builtin.find(item => item.id === id) || null; }
const clientView = row => row && ({ id: row.id, name: row.name, businessPackId: row.business_pack_id, revision: row.revision, archived: Boolean(row.archived), profile: parse(row.profile_json), brand: parse(row.brand_json), createdAt: row.created_at, updatedAt: row.updated_at });
const projectView = row => row && ({ ...parse(row.project_json), id: row.id, clientId: row.client_id, revision: row.revision, archived: Boolean(row.archived), businessPackId: row.business_pack_id, businessPackVersion: row.business_pack_version, recipeId: row.recipe_id, contextSnapshot: parse(row.context_json), createdAt: row.created_at, updatedAt: row.updated_at });
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const getClient = async (env, accountId, id) => clientView(await first(env.DB, 'SELECT * FROM clients WHERE account_id=? AND id=? AND archived=0', accountId, id));
export const getProject = async (env, accountId, clientId, id) => projectView(await first(env.DB, 'SELECT * FROM projects WHERE account_id=? AND client_id=? AND id=? AND archived=0', accountId, clientId, id));
const normalizeSlides = (incoming, previous) => {
  if (!Array.isArray(incoming) || incoming.length !== 5) throw Object.assign(new Error('Exactly five slides are required.'), { status: 400 });
  return incoming.map((slide, i) => {
    const old = previous[i] || {};
    const changed = ['heading', 'body', 'visualPrompt'].some(key => String(slide[key] || '') !== String(old[key] || ''));
    return { ...old, ...slide, id: `slide-${i + 1}`, copyRevision: changed ? Number(old.copyRevision || 1) + 1 : Number(old.copyRevision || 1), approved: changed ? false : Boolean(slide.approved), approvedAt: changed ? '' : String(slide.approvedAt || old.approvedAt || ''), artworkAssetId: changed ? '' : String(slide.artworkAssetId || old.artworkAssetId || ''), artworkReviewed: changed ? false : Boolean(slide.artworkReviewed), artworkReviewedAt: changed ? '' : String(slide.artworkReviewedAt || old.artworkReviewedAt || '') };
  });
};
const balance = async (env, accountId) => {
  const value = await first(env.DB, `SELECT COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE account_id=? AND (expires_at IS NULL OR expires_at>datetime('now'))),0)-COALESCE((SELECT SUM(amount) FROM credit_reservations WHERE account_id=? AND status='reserved'),0) AS available`, accountId, accountId);
  return Math.max(0, Number(value?.available || 0));
};
export async function assetBytes(env, accountId, clientId, assetId) {
  const row = await first(env.DB, 'SELECT object_key,mime FROM assets WHERE account_id=? AND client_id=? AND id=?', accountId, clientId, assetId);
  if (!row) return null;
  const object = await env.ASSETS.get(row.object_key);
  return object ? { bytes: await object.arrayBuffer(), mime: row.mime } : null;
}
export async function saveAsset(env, accountId, clientId, { projectId = null, kind = 'upload', name = 'image', mime, bytes }) {
  if (!await getClient(env, accountId, clientId)) throw Object.assign(new Error('Client not found.'), { status: 404 });
  const id = crypto.randomUUID(), key = `${accountId}/${clientId}/${id}`;
  await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await env.DB.prepare('INSERT INTO assets(id,account_id,client_id,project_id,kind,file_name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, projectId, kind, String(name).slice(0, 200), mime, bytes.byteLength, key, now()).run();
  } catch (error) { await env.ASSETS.delete(key); throw error; }
  return { id, clientId, projectId, kind, fileName: name, mime, size: bytes.byteLength, createdAt: now() };
}
export function decodeImage(data) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!match) throw Object.assign(new Error('Expected PNG, JPEG or WebP image.'), { status: 400 });
  const binary = atob(match[2]);
  if (binary.length > 20_000_000) throw Object.assign(new Error('Image is too large.'), { status: 413 });
  return { mime: match[1], bytes: Uint8Array.from(binary, char => char.charCodeAt(0)) };
}
export async function apiRoute(request, env, viewer, url) {
  const accountId = viewer.account_id, parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent), method = request.method;
  const body = async () => { const data = await request.json(); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('Expected a JSON object.'), { status: 400 }); return data; };
  if (url.pathname === '/api/me' && method === 'GET') {
    const subscription = await first(env.DB, 'SELECT plan_id AS planId,period_start AS periodStart FROM subscriptions WHERE account_id=?', accountId);
    return json({ user: { id: viewer.user_id, email: viewer.email }, account: { id: accountId, role: viewer.role }, plan: subscription || { planId: 'access' }, isAdmin: Boolean(env.ADMIN_EMAIL && viewer.email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()), csrf: viewer.csrf, credits: await balance(env, accountId), companionEnabled: Boolean((await first(env.DB,'SELECT companion_enabled FROM accounts WHERE id=?',accountId))?.companion_enabled) });
  }
  if (url.pathname === '/api/plans' && method === 'GET') return json({ plans: await all(env.DB, 'SELECT id,version,monthly_credits AS monthlyCredits FROM plans WHERE active=1 ORDER BY monthly_credits') });
  if (url.pathname === '/api/admin/accounts' && method === 'GET') {
    if (!env.ADMIN_EMAIL || viewer.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return bad('Not authorized.', 403);
    const accounts = await all(env.DB, 'SELECT a.id,a.name,u.email,s.plan_id AS planId,a.companion_enabled AS companionEnabled FROM accounts a JOIN memberships m ON m.account_id=a.id AND m.role=\'owner\' JOIN users u ON u.id=m.user_id LEFT JOIN subscriptions s ON s.account_id=a.id ORDER BY a.created_at DESC LIMIT 500');
    return json({ accounts });
  }
  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'accounts' && parts[3] && parts[4] === 'allocate' && method === 'POST') {
    if (!env.ADMIN_EMAIL || viewer.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return bad('Not authorized.', 403);
    const input = await body(), plan = await first(env.DB, 'SELECT * FROM plans WHERE id=? AND active=1 ORDER BY version DESC LIMIT 1', String(input.planId || ''));
    if (!plan) return bad('Unknown plan.');
    const target = await first(env.DB, 'SELECT id FROM accounts WHERE id=?', parts[3]);
    if (!target) return bad('Account not found.', 404);
    const period = String(input.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return bad('Period must be YYYY-MM.');
    const source = `manual-plan:${period}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO subscriptions(account_id,plan_id,plan_version,status,period_start,period_end) VALUES(?,?,?,'manual',?,?) ON CONFLICT(account_id) DO UPDATE SET plan_id=excluded.plan_id,plan_version=excluded.plan_version,status='manual',period_start=excluded.period_start,period_end=excluded.period_end").bind(target.id, plan.id, plan.version, `${period}-01`, null),
      env.DB.prepare("INSERT OR IGNORE INTO credit_ledger(id,account_id,amount,kind,source_id) SELECT ?,? ,?,'manual_plan',? WHERE ?>0").bind(crypto.randomUUID(), target.id, plan.monthly_credits, source, plan.monthly_credits)
    ]);
    return json({ accountId: target.id, planId: plan.id, credits: await balance(env, target.id) });
  }
  if (parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'accounts' && parts[3] && parts[4] === 'companion' && method === 'PATCH') {
    if (!env.ADMIN_EMAIL || viewer.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) return bad('Not authorized.',403);
    const input=await body();
    if (typeof input.enabled !== 'boolean') return bad('Expected an enabled flag.');
    const changed=await env.DB.prepare('UPDATE accounts SET companion_enabled=? WHERE id=?').bind(input.enabled?1:0,parts[3]).run();
    if (!changed.meta.changes) return bad('Account not found.',404);
    if (!input.enabled) await env.DB.prepare("UPDATE companion_jobs SET status='cancelled',error='Companion access disabled.' WHERE account_id=? AND status IN ('queued','running')").bind(parts[3]).run();
    return json({enabled:input.enabled});
  }
  if (url.pathname === '/api/business-packs' && method === 'GET') return json({ packs: publicBusinessPacks() });
  if (url.pathname === '/api/status' && method === 'GET') {
    const openai = { available: Boolean(env.OPENAI_API_KEY), label: 'OpenAI API' }, gemini = { available: Boolean(env.GEMINI_API_KEY), label: 'Gemini API' };
    const enabled=Boolean((await first(env.DB,'SELECT companion_enabled FROM accounts WHERE id=?',accountId))?.companion_enabled);
    const local=enabled ? {codex:{available:true,label:'Codex on your computer'},antigravity:{available:true,label:'Antigravity on your computer'}} : {};
    return json({ cloud: true, companionEnabled:enabled, textProviders: { openai, gemini, ...local }, imageProviders: { openai, gemini } });
  }
  if (url.pathname === '/api/dashboard' && method === 'GET') {
    const [clients, projects, jobs] = await Promise.all([
      first(env.DB, 'SELECT COUNT(*) n FROM clients WHERE account_id=? AND archived=0', accountId),
      first(env.DB, 'SELECT COUNT(*) n FROM projects WHERE account_id=? AND archived=0', accountId),
      first(env.DB, "SELECT COUNT(*) n FROM generation_jobs WHERE account_id=? AND status IN ('queued','running')", accountId)
    ]);
    const rows = await all(env.DB, 'SELECT project_json FROM projects WHERE account_id=? AND archived=0', accountId);
    const review = rows.filter(row => parse(row.project_json).slides?.some(slide => slide.artworkAssetId && !slide.artworkReviewed)).length;
    return json({ clients: clients.n, projects: projects.n, review, running: jobs.n });
  }
  if (url.pathname === '/api/all-projects' && method === 'GET') {
    const rows = await all(env.DB, 'SELECT p.*,c.name AS client_name FROM projects p JOIN clients c ON c.id=p.client_id AND c.account_id=p.account_id WHERE p.account_id=? AND p.archived=0 ORDER BY p.updated_at DESC', accountId);
    return json({ projects: rows.map(row => ({ ...projectView(row), clientName: row.client_name })) });
  }
  if (url.pathname === '/api/templates/shared' && method === 'GET') return json({ templates: builtin });
  if (parts[0] === 'api' && parts[1] === 'template-imports') return templateImportRoute(request, env, accountId, url);
  if (url.pathname === '/api/clients' && method === 'GET') return json({ clients: (await all(env.DB, 'SELECT * FROM clients WHERE account_id=? AND archived=0 ORDER BY updated_at DESC', accountId)).map(clientView) });
  if (url.pathname === '/api/clients' && method === 'POST') {
    const input = await body(), name = String(input.name || '').trim().slice(0, 100);
    if (!name) return bad('Client name is required.');
    const pack = getBusinessPack(input.businessPackId), id = crypto.randomUUID(), stamp = now();
    await env.DB.prepare('INSERT INTO clients(id,account_id,name,business_pack_id,profile_json,brand_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, accountId, name, pack.id, JSON.stringify(input.profile || {}), JSON.stringify({ name, ...(input.brand || {}) }), stamp, stamp).run();
    return json({ client: await getClient(env, accountId, id) }, 201);
  }
  if (parts[0] !== 'api' || parts[1] !== 'clients' || !parts[2]) return bad('API route not found.', 404);
  const clientId = parts[2], client = await getClient(env, accountId, clientId);
  if (!client) return bad('Client not found.', 404);
  if (parts.length === 3 && method === 'GET') return json({ client });
  if (parts.length === 3 && method === 'PATCH') {
    const input = await body();
    if (Number(input.expectedRevision) !== client.revision) return bad('Client changed since it was loaded.', 409);
    const name = String(input.name ?? client.name).trim().slice(0, 100) || client.name;
    const profile = { ...client.profile, ...(input.profile || {}) }, brand = { ...client.brand, ...(input.brand || {}), name: String(input.brand?.name ?? client.brand.name ?? name).slice(0, 100) };
    const result = await env.DB.prepare('UPDATE clients SET name=?,profile_json=?,brand_json=?,revision=revision+1,updated_at=? WHERE account_id=? AND id=? AND revision=?').bind(name, JSON.stringify(profile), JSON.stringify(brand), now(), accountId, clientId, client.revision).run();
    if (!result.meta.changes) return bad('Client changed since it was loaded.', 409);
    return json({ client: await getClient(env, accountId, clientId) });
  }
  if (parts[3] === 'projects' && parts.length === 4 && method === 'GET') return json({ projects: (await all(env.DB, 'SELECT * FROM projects WHERE account_id=? AND client_id=? AND archived=0 ORDER BY updated_at DESC', accountId, clientId)).map(projectView) });
  if (parts[3] === 'projects' && parts.length === 4 && method === 'POST') {
    const input = await body(), pack = getBusinessPack(client.businessPackId), context = resolveBusinessContext(client, input.contextOverrides || {}), id = crypto.randomUUID(), stamp = now();
    const project = { schemaVersion: 1, topic: String(input.topic || '').slice(0, 450), key: String(input.key || '').slice(0, 80), notes: String(input.notes || '').slice(0, 4000), language: String(input.language || context.language).slice(0, 80), templateId: String(input.templateId || ''), templateVersion: '', slides: Array.isArray(input.slides) && input.slides.length === 5 ? input.slides : starterSlidesForPack(pack.id), instagram: String(input.instagram || ''), facebook: String(input.facebook || ''), youtubeTitle: '', youtubeDescription: '', generation: repairGeneration(input.generation), stage: Number(input.stage) || 0, exportHistory: [] };
    await env.DB.prepare('INSERT INTO projects(id,account_id,client_id,business_pack_id,business_pack_version,recipe_id,context_json,project_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, pack.id, pack.version, context.recipe.id, JSON.stringify(context), JSON.stringify(project), stamp, stamp).run();
    return json({ project: await getProject(env, accountId, clientId, id) }, 201);
  }
  if (parts[3] === 'templates' && parts.length === 4 && method === 'GET') {
    const custom = (await all(env.DB, 'SELECT * FROM templates WHERE account_id=? AND client_id=? AND business_pack_id=? ORDER BY created_at DESC', accountId, clientId, client.businessPackId)).map(row => ({ id: row.id, clientId, name: row.name, businessPackId: row.business_pack_id, mode: row.mode, data: parse(row.data_json) }));
    return json({ templates: custom });
  }
  if (parts[3] === 'templates' && parts.length === 5 && method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM templates WHERE account_id=? AND client_id=? AND id=?').bind(accountId, clientId, parts[4]).run();
    return result.meta.changes ? json({ removed: true }) : bad('Client style not found.', 404);
  }
  if (parts[3] === 'templates' && parts.length === 4 && method === 'POST') {
    const input = await body();
    if (Array.isArray(input.images)) {
      if (input.images.length !== 5) return bad('A generated style needs five slide images.');
      const images = input.images.map(decodeImage);
      const id = crypto.randomUUID(), name = String(input.name || 'Generated style').trim().slice(0, 100);
      const refs = [];
      for (const [i, image] of images.entries()) refs.push(await saveAsset(env, accountId, clientId, { kind: 'template-reference', name: `${name}-${i + 1}`, ...image }));
      const data = { slides: refs.map((asset, i) => ({ position: i + 1, assetId: asset.id })) };
      await env.DB.prepare('INSERT INTO templates(id,account_id,client_id,name,business_pack_id,mode,data_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, name, client.businessPackId, 'slides', JSON.stringify(data), now()).run();
      return json({ template: { id, clientId, name, businessPackId: client.businessPackId, mode: 'slides', data } }, 201);
    }
    const image = decodeImage(input.image), asset = await saveAsset(env, accountId, clientId, { kind: 'template-reference', name: input.name || 'Reference', ...image });
    const id = crypto.randomUUID(), name = String(input.name || 'Custom reference').trim().slice(0, 100);
    await env.DB.prepare('INSERT INTO templates(id,account_id,client_id,name,business_pack_id,mode,data_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, name, client.businessPackId, 'slides', JSON.stringify({ slides: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, assetId: asset.id })) }), now()).run();
    return json({ template: { id, clientId, name, businessPackId: client.businessPackId, mode: 'slides', data: { slides: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, assetId: asset.id })) } } }, 201);
  }
  if (parts[3] === 'style-maker' && parts[4] === 'render' && parts.length === 5 && method === 'POST') return json(await renderStyleBoard(env, accountId, client, await body()));
  if (parts[3] === 'import-project' && parts.length === 4 && method === 'POST') {
    const input = await body(), source = input.project;
    if (!source || !Array.isArray(source.slides) || source.slides.length !== 5) return bad('Invalid portable project.');
    if (source.businessPackId && source.businessPackId !== client.businessPackId) return bad('Project business type does not match this client.');
    const embedded = input.embeddedAssets || {};
    if (embedded.template && (embedded.template.mode === 'slides' ? embedded.template.images?.length !== 5 : embedded.template.mode === 'board' ? embedded.template.images?.length !== 1 : true)) return bad('Portable template references are incomplete.');
    for (const value of [...Object.values(embedded.artworks || {}), ...(embedded.template?.images || []), ...(embedded.logo ? [embedded.logo] : [])]) decodeImage(value);
    const pack = getBusinessPack(client.businessPackId), context = resolveBusinessContext(client), id = crypto.randomUUID(), stamp = now();
    const slides = source.slides.map((slide, i) => ({ ...slide, id: `slide-${i + 1}`, artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' }));
    const project = { schemaVersion: 1, topic: String(source.topic || '').slice(0, 450), key: String(source.key || '').slice(0, 80), notes: String(source.notes || '').slice(0, 4000), language: String(source.language || context.language).slice(0, 80), templateId: '', templateVersion: '', slides, instagram: String(source.instagram || ''), facebook: String(source.facebook || ''), youtubeTitle: String(source.youtubeTitle || ''), youtubeDescription: String(source.youtubeDescription || ''), generation: repairGeneration(source.generation), stage: Number(source.stage) || 0, exportHistory: [] };
    await env.DB.prepare('INSERT INTO projects(id,account_id,client_id,business_pack_id,business_pack_version,recipe_id,context_json,project_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, pack.id, pack.version, context.recipe.id, JSON.stringify(context), JSON.stringify(project), stamp, stamp).run();
    for (let i = 0; i < 5; i++) if (embedded.artworks?.[`slide-${i + 1}`]) {
      const image = decodeImage(embedded.artworks[`slide-${i + 1}`]);
      const asset = await saveAsset(env, accountId, clientId, { projectId: id, kind: 'imported-artwork', name: `slide-${i + 1}`, ...image });
      slides[i].artworkAssetId = asset.id; slides[i].artworkReviewed = Boolean(source.slides[i].artworkReviewed);
    }
    if (embedded.template?.images?.length) {
      const template = embedded.template, refs = [];
      for (const [i, value] of template.images.entries()) refs.push(await saveAsset(env, accountId, clientId, { kind: 'template-reference', name: `template-${i + 1}`, ...decodeImage(value) }));
      const templateId = `portable:${id}:template`, data = template.mode === 'board' ? { assetId: refs[0].id, crops: template.crops || [] } : { slides: refs.slice(0, 5).map((asset, i) => ({ position: i + 1, assetId: asset.id })) };
      await env.DB.prepare('INSERT INTO templates(id,account_id,client_id,name,business_pack_id,mode,data_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(templateId, accountId, clientId, String(template.name || 'Imported template').slice(0, 100), pack.id, template.mode, JSON.stringify(data), now()).run();
      project.templateId = templateId;
    }
    let importedContext = context;
    if (embedded.logo) {
      const logo = await saveAsset(env, accountId, clientId, { kind: 'imported-project-logo', name: 'logo', ...decodeImage(embedded.logo) });
      importedContext = { ...context, brand: { ...context.brand, logoAssetId: logo.id } };
    }
    await env.DB.prepare('UPDATE projects SET project_json=?,context_json=? WHERE id=? AND account_id=?').bind(JSON.stringify(project), JSON.stringify(importedContext), id, accountId).run();
    return json({ project: await getProject(env, accountId, clientId, id) }, 201);
  }
  if (parts[3] === 'assets' && parts.length === 5 && method === 'GET') {
    const row = await first(env.DB, 'SELECT object_key,mime FROM assets WHERE account_id=? AND client_id=? AND id=?', accountId, clientId, parts[4]);
    if (!row) return bad('Asset not found.', 404);
    const object = await env.ASSETS.get(row.object_key);
    if (!object) return bad('Asset not found.', 404);
    return new Response(object.body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=120', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (parts[3] === 'assets' && parts.length === 4 && method === 'POST') {
    const input = await body(), image = decodeImage(input.image);
    return json({ asset: await saveAsset(env, accountId, clientId, { projectId: input.projectId || null, kind: input.kind || 'upload', name: input.name || 'image', ...image }) }, 201);
  }
  if (parts[3] === 'projects' && parts[4] && parts.length >= 5) {
    const projectId = parts[4], project = await getProject(env, accountId, clientId, projectId);
    if (!project) return bad('Project not found.', 404);
    if (parts.length === 5 && method === 'GET') return json({ project });
    if (parts.length === 5 && method === 'PATCH') {
      const input = await body();
      if (Number(input.expectedRevision) !== project.revision) return bad('Project changed since it was loaded.', 409);
      const next = { ...project, ...input, language: String(input.language ?? project.language).slice(0, 80), generation: repairGeneration(input.generation ?? project.generation), slides: normalizeSlides(input.slides ?? project.slides, project.slides) };
      if (imageFormat(next.generation?.aspectRatio).ratio !== imageFormat(project.generation?.aspectRatio).ratio) next.slides = next.slides.map(slide => ({ ...slide, artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' }));
      if (next.templateId !== project.templateId || next.language !== project.language) next.slides = next.slides.map(slide => ({ ...slide, approved: false, approvedAt: '', artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' }));
      for (const key of ['id', 'clientId', 'revision', 'archived', 'businessPackId', 'businessPackVersion', 'recipeId', 'contextSnapshot', 'createdAt', 'updatedAt', 'expectedRevision']) delete next[key];
      const result = await env.DB.prepare('UPDATE projects SET project_json=?,revision=revision+1,updated_at=? WHERE account_id=? AND client_id=? AND id=? AND revision=?').bind(JSON.stringify(next), now(), accountId, clientId, projectId, project.revision).run();
      if (!result.meta.changes) return bad('Project changed since it was loaded.', 409);
      return json({ project: await getProject(env, accountId, clientId, projectId) });
    }
    if (parts[5] === 'apply-client-settings' && method === 'POST') {
      const input = await body();
      if (Number(input.expectedRevision) !== project.revision) return bad('Project changed since it was loaded.', 409);
      const context = resolveBusinessContext(client), next = { ...parse((await first(env.DB, 'SELECT project_json FROM projects WHERE id=? AND account_id=?', projectId, accountId)).project_json), slides: project.slides.map(slide => ({ ...slide, approved: false, approvedAt: '', artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' })) };
      await env.DB.prepare('UPDATE projects SET context_json=?,project_json=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?').bind(JSON.stringify(context), JSON.stringify(next), now(), projectId, accountId, project.revision).run();
      return json({ project: await getProject(env, accountId, clientId, projectId) });
    }
    if (parts[5] === 'jobs' && parts[6] && method === 'DELETE') {
      const cloud = await cancelJob(env, accountId, projectId, parts[6]);
      if (cloud) return json(cloud);
      const local = await first(env.DB, 'SELECT id,status FROM companion_jobs WHERE id=? AND account_id=? AND project_id=?', parts[6], accountId, projectId);
      if (!local) return bad('Job not found.',404);
      await env.DB.prepare("UPDATE companion_jobs SET status='cancelled',error='Generation stopped.' WHERE id=? AND account_id=? AND project_id=? AND status IN ('queued','running')").bind(parts[6],accountId,projectId).run();
      return json({ok:true});
    }
    if (parts[5] === 'jobs' && parts[6] && method === 'GET') {
      const row = await first(env.DB, 'SELECT * FROM generation_jobs WHERE account_id=? AND project_id=? AND id=?', accountId, projectId, parts[6]);
      if (!row) { const local=await first(env.DB,'SELECT id,status,error FROM companion_jobs WHERE account_id=? AND project_id=? AND id=?',accountId,projectId,parts[6]); if (!local) return bad('Job not found.',404); return json({job:{id:local.id,status:local.status,error:local.error||'',quotedCredits:0}}); }
      return json({ job: { id: row.id, status: row.status, error: row.error || '', quotedCredits: row.quoted_credits } });
    }
    if (parts[5] === 'jobs' && method === 'GET') return json({ jobs: (await all(env.DB, 'SELECT id,slide_index AS slideIndex,action AS stage,provider,model_id AS model,status,1 AS attempt,error,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt FROM generation_jobs WHERE account_id=? AND project_id=? ORDER BY created_at DESC LIMIT 100', accountId, projectId)) });
    if (parts[5] === 'jobs' && method === 'POST') { const input=await body(); return json(['codex','antigravity'].includes(input.provider) ? await enqueueCompanion(env,viewer,project,input) : await runJob(env, accountId, clientId, project, input)); }
  }
  return bad('API route not found.', 404);
}
