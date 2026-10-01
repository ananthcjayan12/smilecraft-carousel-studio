import { imageFormat, openaiImageSize } from '../web/image-formats.js';
import { enqueueCompanionStyle } from './companion.mjs';
import { IMAGE_MODELS } from '../web/provider-models.js';
import { buildV1StylePrompt } from './prompts.mjs';
import { assetBytes, decodeImage } from './studio.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const limit = (value, size) => String(value ?? '').trim().slice(0, size);
const imageBase64 = bytes => {
  const array = new Uint8Array(bytes);
  let result = '';
  for (let i = 0; i < array.length; i += 8190) result += btoa(String.fromCharCode(...array.slice(i, i + 8190)));
  return result;
};
const findImage = value => {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.data === 'string' && value.data.length > 1000 && (value.mime_type || value.mimeType)) return { base64: value.data, mime: value.mime_type || value.mimeType };
  if (typeof value.b64_json === 'string') return { base64: value.b64_json, mime: 'image/png' };
  for (const item of Object.values(value)) {
    const found = Array.isArray(item) ? item.map(findImage).find(Boolean) : findImage(item);
    if (found) return found;
  }
  return null;
};

export async function renderStyleBoard(env, accountId, client, input, viewer) {
  const designId = limit(input.designId, 50);
  if (!/^(teal-editorial-pro|clinical-white|warm-ivory|deep-teal-premium|mint-friendly|airy-aqua|kids-mint|nature-sage|warm-clinical|premium-charcoal)$/.test(designId)) throw fail('Choose a design direction.');
  const provider = limit(input.provider, 20), model = limit(input.model, 100);
  const local = ['codex','antigravity'].includes(provider);
  if (!local && (!['openai', 'gemini'].includes(provider) || !env[provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'])) throw fail('The selected image provider is unavailable.', 409);
  if (!local && !IMAGE_MODELS[provider]?.some(([id]) => id === model)) throw fail('Choose a listed image model.');
  const name = limit(input.name || client.brand?.name || client.name, 100);
  const businessType = limit(input.businessType, 100);
  if (!name || !businessType) throw fail('Add a business name and industry.');
  const logo = input.logoImage ? decodeImage(input.logoImage) : client.brand?.logoAssetId ? await assetBytes(env, accountId, client.id, client.brand.logoAssetId) : null;
  if (!logo && !input.sourceTemplateId) throw fail('Upload a logo in the brand kit or add one here first.');
  if (input.sourceTemplateId) {
    const source = await env.DB.prepare('SELECT id FROM templates WHERE account_id=? AND client_id=? AND business_pack_id=? AND id=?').bind(accountId, client.id, client.businessPackId, input.sourceTemplateId).first();
    if (!source) throw fail('Client style not found.', 404);
  }
  const mood = input.moodImage ? decodeImage(input.moodImage) : null;
  const customReference = input.sourceTemplateId ? decodeImage(input.referenceImage) : null;
  const reference = customReference ? null : await env.STATIC.fetch(new Request(new URL(`/assets/design-systems/${designId}.png`, env.APP_ORIGIN)));
  if (reference && !reference.ok) throw fail('Design inspiration is unavailable.', 503);
  const direction = limit(input.direction, 500), language = limit(input.language, 100), languageNotes = limit(input.languageNotes, 400);
  const primary = /^#[0-9a-fA-F]{6}$/.test(input.primary) ? input.primary : '#073a42';
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accent) ? input.accent : '#14ada9';
  const prompt = buildV1StylePrompt({ design: input.design, brand: { name, primary, accent }, businessType, language, languageNotes, direction, sourceTemplateId: input.sourceTemplateId, revisionNotes: input.revisionNotes, aspectRatio: input.aspectRatio });
  if(local) {
    const referenceBytes=customReference ? customReference.bytes : await reference.arrayBuffer();
    const references=[{name:'reference',mime:customReference?.mime || 'image/png',data:imageBase64(referenceBytes)}];
    if(logo) references.push({name:'logo',mime:logo.mime,data:imageBase64(logo.bytes)});
    if(mood) {
      if(logo) references[0]={name:'annotated-reference',mime:mood.mime,data:imageBase64(mood.bytes)};
      else references.push({name:'annotations',mime:mood.mime,data:imageBase64(mood.bytes)});
    }
    if(references.some(r=>r.data.length>10_600_000)) throw fail('Reference image is too large for companion generation.',413);
    return enqueueCompanionStyle(env,viewer,client,{provider,model,prompt:prompt+(mood && logo ? '\nFor this local request, the first reference contains the numbered red editing marks. Use it as the existing composition, follow the matching instructions and remove all marks from the result. The second image is the exact logo.' : ''),references,aspectRatio:input.sourceTemplateId ? imageFormat(input.aspectRatio).ratio : '4:3'});
  }
  const creditId = crypto.randomUUID();
  const debit = await env.DB.prepare(`INSERT INTO credit_ledger(id,account_id,amount,kind,source_id)
    SELECT ?,?,-10,'style_generation',? WHERE
    (SELECT COALESCE(SUM(amount),0) FROM credit_ledger WHERE account_id=? AND (expires_at IS NULL OR expires_at>datetime('now')))
    -(SELECT COALESCE(SUM(amount),0) FROM credit_reservations WHERE account_id=? AND status='reserved') >= 10`)
    .bind(creditId, accountId, creditId, accountId, accountId).run();
  if (!debit.meta.changes) throw fail('Insufficient credits. Creating a style costs 10 credits.', 402);
  try {
    const referenceBytes = customReference ? customReference.bytes : await reference.arrayBuffer();
    let result;
    if (provider === 'openai') {
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('size', input.sourceTemplateId ? openaiImageSize(model,input.aspectRatio) : '1536x1024'); form.append('quality', 'medium'); form.append('output_format', 'png');
      form.append('image[]', new Blob([referenceBytes], { type: customReference?.mime || 'image/png' }), 'inspiration.png');
      if (logo) form.append('image[]', new Blob([logo.bytes], { type: logo.mime }), 'logo');
      if (mood) form.append('image[]', new Blob([mood.bytes], { type: mood.mime }), 'mood');
      const response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
      if (!response.ok) throw fail(`Image provider rejected the request (${response.status}).`, 502);
      result = findImage(await response.json());
    } else {
      const images = [{ type: 'image', mime_type: customReference?.mime || 'image/png', data: imageBase64(referenceBytes) }];
      if (logo) images.push({ type: 'image', mime_type: logo.mime, data: imageBase64(logo.bytes) });
      if (mood) images.push({ type: 'image', mime_type: mood.mime, data: imageBase64(mood.bytes) });
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', { method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: [{ type: 'text', text: prompt }, ...images], response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: input.sourceTemplateId ? (imageFormat(input.aspectRatio).geminiRatio || imageFormat(input.aspectRatio).ratio) : '4:3', image_size: '2K' } }) });
      if (!response.ok) throw fail(`Image provider rejected the request (${response.status}).`, 502);
      result = findImage(await response.json());
    }
    if (!result?.base64) throw fail('The image provider returned no design board.', 502);
    return { image: `data:${result.mime || 'image/png'};base64,${result.base64}` };
  } catch (error) {
    await env.DB.prepare("INSERT OR IGNORE INTO credit_ledger(id,account_id,amount,kind,source_id) VALUES(?,?,10,'style_refund',?)").bind(crypto.randomUUID(), accountId, `refund:${creditId}`).run();
    throw error;
  }
}
