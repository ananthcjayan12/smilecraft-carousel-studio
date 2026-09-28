import { compatibleModel, IMAGE_MODELS, WRITING_MODELS } from '../web/provider-models.js';
import { getProject, assetBytes, saveAsset, builtinTemplate } from './studio.mjs';
import { buildV1WritingPrompt, buildV1ImagePrompt } from './prompts.mjs';

const price = { draft: 2, revise: 1, image: 10 };
const stamp = () => new Date().toISOString();
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const jobView = row => ({ id: row.id, stage: row.action, status: row.status, error: row.error || '', quotedCredits: row.quoted_credits, createdAt: row.created_at });

export async function runJob(env, accountId, clientId, project, input) {
  const stage = String(input.stage || '');
  if (!(stage in price)) throw error('Choose draft, revise, or image generation.');
  const provider = String(input.provider || '');
  if (!['openai', 'gemini'].includes(provider) || !env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY']) throw error('The selected provider is unavailable.', 409);
  const catalog = stage === 'image' ? IMAGE_MODELS : WRITING_MODELS;
  const model = compatibleModel(provider, input.model, stage === 'image' ? 'image' : 'writing');
  if (!catalog[provider].some(([id]) => id === model)) throw error('Choose a listed model.');
  const slideIndex = stage === 'draft' ? null : Number(input.slideIndex);
  if (stage !== 'draft' && (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex > 4)) throw error('Choose one of the five slides.');
  if (stage === 'image' && !project.slides?.[slideIndex]?.approved) throw error('Approve the slide copy before creating artwork.');
  const idempotencyKey = String(input.idempotencyKey || '').slice(0, 120);
  if (!idempotencyKey || idempotencyKey.length < 16) throw error('A unique request key is required.');
  const existing = await env.DB.prepare('SELECT * FROM generation_jobs WHERE account_id=? AND idempotency_key=?').bind(accountId, idempotencyKey).first();
  if (existing) return { job: jobView(existing) };
  const id = crypto.randomUUID(), credits = price[stage];
  const correction = limit(input.correction, 500);
  const [created] = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO generation_jobs(id,account_id,project_id,action,model_id,status,idempotency_key,quoted_credits,provider,slide_index,correction)
      SELECT ?,?,?,?,?, 'queued', ?,?,?,?,? WHERE
      (SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE account_id=? AND (expires_at IS NULL OR expires_at>datetime('now')))
      -(SELECT COALESCE(SUM(amount),0) FROM credit_reservations WHERE account_id=? AND status='reserved') >= ?`)
      .bind(id, accountId, project.id, stage, model, idempotencyKey, credits, provider, slideIndex, correction, accountId, accountId, credits),
    env.DB.prepare(`INSERT INTO credit_reservations(job_id,account_id,amount,status) SELECT id,account_id,quoted_credits,'reserved' FROM generation_jobs WHERE id=?`).bind(id)
  ]);
  if (!created.meta.changes) {
    const duplicate = await env.DB.prepare('SELECT * FROM generation_jobs WHERE account_id=? AND idempotency_key=?').bind(accountId, idempotencyKey).first();
    if (duplicate) return { job: jobView(duplicate) };
    throw error(`Insufficient credits. ${credits} credits are required for this action.`, 402);
  }
  try { await env.GENERATION.send({ jobId: id }); }
  catch (cause) { await failJob(env, id, 'Could not queue generation.'); throw error('Could not queue generation. Please retry.', 503); }
  return { job: { id, stage, status: 'queued', quotedCredits: credits } };
}

async function failJob(env, id, message) {
  await env.DB.batch([
    env.DB.prepare("UPDATE generation_jobs SET status='failed',error=?,finished_at=? WHERE id=? AND status IN ('queued','running')").bind(String(message).slice(0, 350), stamp(), id),
    env.DB.prepare("UPDATE credit_reservations SET status='released',updated_at=? WHERE job_id=? AND status='reserved'").bind(stamp(), id)
  ]);
}

async function providerJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Provider request failed', response.status, String(data.error?.code || data.error?.status || ''));
    throw error(`The AI provider rejected this request (${response.status}). Check the configured key, model, and account access.`, 502);
  }
  return data;
}
const limit = (v, n) => String(v ?? '').slice(0, n);
const parseJson = raw => {
  const value = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(value); } catch { throw error('The provider returned invalid JSON. Retry generation.', 502); }
};
const slide = (value, index, role) => ({ id: `slide-${index + 1}`, role, heading: limit(value.heading, 100), body: limit(value.body, 240), visualPrompt: limit(value.visualPrompt, 550), approved: false, approvedAt: '', copyRevision: 1, artworkAssetId: '', artworkReviewed: false, artworkReviewedAt: '' });
async function generateText(env, job, project) {
  const revision = job.action === 'revise', context = project.contextSnapshot || {}, roles = context.recipe?.roles || ['Hook','Offering','Benefits','Details','CTA'];
  const prompt = buildV1WritingPrompt(revision ? 'revise' : 'draft', { contextSnapshot: { ...context, language: project.language }, topic: project.topic, notes: project.notes, slide: revision ? project.slides[job.slide_index] : undefined, correction: job.correction, referenceContext: project.templateId ? { id: project.templateId } : null });
  let raw;
  if (job.provider === 'openai') {
    const data = await providerJson('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: job.model_id, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }) });
    raw = data.choices?.[0]?.message?.content;
  } else {
    const data = await providerJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(job.model_id)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  }
  const result = parseJson(raw);
  if (revision) {
    if (!result.heading || !result.body) throw error('The provider returned incomplete slide copy.', 502);
    const slides = [...project.slides];
    slides[job.slide_index] = { ...slide(result, job.slide_index, slides[job.slide_index].role), copyRevision: (slides[job.slide_index].copyRevision || 1) + 1 };
    return { slides };
  }
  if (!Array.isArray(result.slides) || result.slides.length !== 5 || result.slides.some(item => !item.heading || !item.body)) throw error('The provider returned an incomplete five-slide draft.', 502);
  return { slides: result.slides.map((item, i) => slide(item, i, roles[i])), instagram: limit(result.instagram, 3500), facebook: limit(result.facebook || result.instagram, 3500), youtubeTitle: limit(result.youtubeTitle, 120), youtubeDescription: limit(result.youtubeDescription, 4500), stage: 1 };
}

function findImage(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.data === 'string' && value.data.length > 1000 && (value.mime_type || value.mimeType)) return { base64: value.data, mime: value.mime_type || value.mimeType };
  for (const child of Object.values(value)) { const found = Array.isArray(child) ? child.map(findImage).find(Boolean) : findImage(child); if (found) return found; }
  return null;
}
async function generateImage(env, job, project, clientId) {
  const item = project.slides[job.slide_index], context = project.contextSnapshot || {};
  const prompt = buildV1ImagePrompt({ slide: item, slideNumber: job.slide_index + 1, contextSnapshot: { ...context, language: project.language }, brand: context.brand, referenceContext: project.templateId ? { id: project.templateId } : null, correction: job.correction });
  const template = builtinTemplate(project.templateId);
  const selected = template || await env.DB.prepare('SELECT * FROM templates WHERE id=? AND account_id=? AND client_id=?').bind(project.templateId, job.account_id, clientId).first();
  if (!selected || (selected.businessPackId || selected.business_pack_id) !== project.businessPackId) throw error('The selected reference is unavailable.', 400);
  const data = template?.data || JSON.parse(selected.data_json);
  const ref = (template?.mode || selected.mode) === 'slides' ? data.slides[job.slide_index] : data.cropPaths ? { staticPath: data.cropPaths[job.slide_index] } : data;
  let referenceBytes, referenceMime;
  if (ref.staticPath) {
    const response = await env.STATIC.fetch(new Request(new URL(ref.staticPath, env.APP_ORIGIN)));
    if (!response.ok) throw error('Reference image is unavailable.', 503);
    referenceBytes = await response.arrayBuffer(); referenceMime = response.headers.get('content-type')?.split(';')[0] || (ref.staticPath.endsWith('.png') ? 'image/png' : 'image/jpeg');
  } else {
    const asset = await assetBytes(env, job.account_id, clientId, ref.assetId);
    if (!asset) throw error('Reference image is unavailable.', 503);
    referenceBytes = asset.bytes; referenceMime = asset.mime;
  }
  let image;
  if (job.provider === 'openai') {
    const form = new FormData();
    form.append('model', job.model_id); form.append('prompt', prompt); form.append('size', '1024x1536'); form.append('quality', 'medium'); form.append('output_format', 'png');
    form.append('image[]', new Blob([referenceBytes], { type: referenceMime }), 'reference');
    const logoId = context.brand?.logoAssetId;
    if (logoId) { const logo = await assetBytes(env, job.account_id, clientId, logoId); if (logo) form.append('image[]', new Blob([logo.bytes], { type: logo.mime }), 'logo'); }
    const data = await providerJson('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
    image = { base64: data.data?.[0]?.b64_json, mime: 'image/png' };
  } else {
    const bytes = new Uint8Array(referenceBytes);
    let base64 = ''; for (let i = 0; i < bytes.length; i += 8190) base64 += btoa(String.fromCharCode(...bytes.slice(i, i + 8190)));
    const data = await providerJson('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: job.model_id, input: [{ type: 'text', text: prompt }, { type: 'image', mime_type: referenceMime, data: base64 }], response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '4:5', image_size: '2K' } }) });
    image = findImage(data);
  }
  if (!image?.base64) throw error('The provider returned no artwork.', 502);
  const binary = atob(image.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const asset = await saveAsset(env, job.account_id, clientId, { projectId: project.id, kind: 'generated', name: `slide-${job.slide_index + 1}.png`, mime: image.mime || 'image/png', bytes });
  const slides = [...project.slides];
  slides[job.slide_index] = { ...item, artworkAssetId: asset.id, artworkProvider: job.provider, artworkGeneratedAt: stamp(), artworkReviewed: false, artworkReviewedAt: '' };
  return { slides };
}

export async function consumeJob(env, id) {
  const claimed = await env.DB.prepare("UPDATE generation_jobs SET status='running',started_at=? WHERE id=? AND status='queued' RETURNING *").bind(stamp(), id).first();
  if (!claimed) return;
  try {
    const row = await env.DB.prepare('SELECT client_id FROM projects WHERE id=? AND account_id=? AND archived=0').bind(claimed.project_id, claimed.account_id).first();
    if (!row) throw error('Project no longer exists.', 404);
    const project = await getProject(env, claimed.account_id, row.client_id, claimed.project_id);
    if (!project) throw error('Project no longer exists.', 404);
    const changes = claimed.action === 'image' ? await generateImage(env, claimed, project, row.client_id) : await generateText(env, claimed, project);
    for (let attempt = 0; attempt < 8; attempt++) {
      let current = project, merged = changes;
      if (claimed.action === 'image') {
        current = await getProject(env, claimed.account_id, row.client_id, claimed.project_id);
        if (!current || current.slides[claimed.slide_index].copyRevision !== project.slides[claimed.slide_index].copyRevision || !current.slides[claimed.slide_index].approved) throw error('Slide copy changed during image generation. Credits were returned.', 409);
        const slides = [...current.slides];
        slides[claimed.slide_index] = { ...slides[claimed.slide_index], ...changes.slides[claimed.slide_index] };
        merged = { slides };
      }
      const { id: _id, clientId: _client, revision: _revision, archived: _archived, businessPackId: _pack, businessPackVersion: _version, recipeId: _recipe, contextSnapshot: _context, createdAt: _created, updatedAt: _updated, ...persisted } = { ...current, ...merged };
      const [updated] = await env.DB.batch([
        env.DB.prepare('UPDATE projects SET project_json=?,revision=revision+1,updated_at=? WHERE id=? AND account_id=? AND revision=?').bind(JSON.stringify(persisted), stamp(), project.id, claimed.account_id, current.revision),
        env.DB.prepare("INSERT INTO credit_ledger(id,account_id,amount,kind,source_id) SELECT ?,r.account_id,-r.amount,'generation',? FROM credit_reservations r WHERE r.job_id=? AND r.status='reserved' AND changes()=1 AND EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND p.revision=?)").bind(crypto.randomUUID(), `job:${id}`, id, project.id, current.revision + 1),
        env.DB.prepare("UPDATE credit_reservations SET status='settled',updated_at=? WHERE job_id=? AND status='reserved' AND EXISTS (SELECT 1 FROM credit_ledger WHERE source_id=?)").bind(stamp(), id, `job:${id}`),
        env.DB.prepare("UPDATE generation_jobs SET status='succeeded',finished_at=? WHERE id=? AND status='running' AND EXISTS (SELECT 1 FROM credit_ledger WHERE source_id=?)").bind(stamp(), id, `job:${id}`)
      ]);
      if (updated.meta.changes) return;
      if (claimed.action !== 'image') break;
    }
    throw error('Project changed during generation. Credits were returned.', 409);
  } catch (cause) { await failJob(env, id, cause.message || 'Generation failed.'); }
}

export async function recoverStaleJobs(env) {
  const stale = (await env.DB.prepare("SELECT id FROM generation_jobs WHERE status IN ('queued','running') AND datetime(COALESCE(started_at,created_at)) < datetime('now','-30 minutes') LIMIT 100").all()).results;
  for (const row of stale) await failJob(env, row.id, 'Generation timed out. Credits were returned.');
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
}
