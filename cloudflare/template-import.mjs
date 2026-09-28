import { unzipSync } from 'fflate';
import { getClient, saveAsset } from './studio.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const read = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const stamp = () => new Date().toISOString();
const imageMime = (bytes) => {
  if (bytes.length > 20_000_000) fail('An image exceeds 20 MB.', 413);
  if (bytes.length > 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  fail('Only PNG, JPEG and WebP references are supported.');
};
function unpack(bytes) {
  if (bytes.length > 30_000_000) fail('Template ZIP exceeds 30 MB.', 413);
  let count = 0, expanded = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter: entry => {
        const name = entry.name.replaceAll('\\', '/');
        if (name.startsWith('/') || name.split('/').includes('..') || /^[a-z]:/i.test(name)) fail('Unsafe ZIP path.');
        count++; expanded += entry.originalSize;
        if (count > 50 || expanded > 80_000_000 || entry.originalSize > 20_000_000) fail('Template ZIP exceeds extraction limits.', 413);
        return !name.endsWith('/');
      }
    });
  } catch (error) { if (error.status) throw error; fail('Invalid or unsupported template ZIP.'); }
  return files;
}
function preview(files, businessPackId) {
  const names = Object.keys(files).filter(name => !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store'));
  const images = names.filter(name => !/\.(?:json|md|txt)$/i.test(name)).map(name => ({ name, size: files[name].length, mime: imageMime(files[name]) }));
  if (!images.length) fail('No images were found in the ZIP.');
  let manifest;
  if (files['pack.json']) { try { manifest = JSON.parse(new TextDecoder().decode(files['pack.json'])); } catch { fail('pack.json is not valid JSON.'); } }
  if (manifest) {
    if (manifest.schemaVersion !== 1 || !manifest.id || !manifest.version || !Array.isArray(manifest.templates)) fail('Invalid pack.json manifest.');
    return { kind: 'manifest', manifest, images, unresolved: false };
  }
  const legacy = [['teal-editorial-pro', .205, .744], ['clinical-white', .205, .752], ['warm-ivory', .064, .811], ['deep-teal-premium', .181, .848], ['mint-friendly', .158, .864], ['airy-aqua', .160, .824], ['kids-mint', .177, .866], ['nature-sage', .172, .826], ['warm-clinical', .205, .915], ['premium-charcoal', .163, .736]];
  if (businessPackId === 'dental' && legacy.every(([id]) => images.some(image => image.name.endsWith(`${id}.png`)))) {
    return { kind: 'legacy-smilecraft', images, unresolved: false, packId: 'smilecraft-masters', version: '1.0.0', templates: legacy.map(([id, top, bottom]) => ({ id, name: id.replaceAll('-', ' '), mode: 'board', image: images.find(image => image.name.endsWith(`${id}.png`)).name, crops: Array.from({ length: 5 }, (_, i) => ({ position: i + 1, top, bottom, left: .006, right: .006, gap: .005 })) })) };
  }
  const ordered = [...images].sort((a, b) => a.name.localeCompare(b.name));
  return { kind: 'image-only', images, unresolved: images.length !== 5, packId: `${businessPackId}-import`, version: '1.0.0', templates: images.length === 5 ? [{ id: 'five-slide-reference', name: 'Five-slide reference', mode: 'slides', slides: ordered.map((item, i) => ({ position: i + 1, image: item.name })) }] : [] };
}
function checkedTemplates(value, files) {
  if (!Array.isArray(value) || !value.length || value.length > 20) fail('Map one to twenty templates.');
  return value.map(item => {
    const id = String(item.id || '').trim(), name = String(item.name || id).trim().slice(0, 100);
    if (!/^[a-z0-9-]{1,80}$/.test(id) || !name) fail('Each template needs a simple ID and name.');
    if (item.mode === 'slides') {
      if (!Array.isArray(item.slides) || item.slides.length !== 5) fail('A slide template needs five references.');
      const slides = item.slides.map((s, i) => ({ position: Number(s.position), image: String(s.image || '') }));
      if (slides.map(s => s.position).sort().join(',') !== '1,2,3,4,5') fail('Slide positions must be 1–5.');
      for (const s of slides) if (!files[s.image]) fail(`Missing reference: ${s.image}`); else imageMime(files[s.image]);
      return { id, name, mode: 'slides', slides };
    }
    if (item.mode === 'board' && files[item.image] && Array.isArray(item.crops) && item.crops.length === 5) {
      imageMime(files[item.image]);
      const crops = item.crops.map(c => {
        const result = c.width != null ? Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Number(c[k])])) : Object.fromEntries(['top', 'bottom', 'left', 'right', 'gap'].map(k => [k, Number(c[k])]));
        if (!Object.values(result).every(Number.isFinite)) fail('Board crop values must be numeric.');
        if ('width' in result ? result.x < 0 || result.y < 0 || result.width <= 0 || result.height <= 0 || result.x + result.width > 1 || result.y + result.height > 1 : result.top < 0 || result.bottom > 1 || result.top >= result.bottom || result.left < 0 || result.right < 0 || result.gap < 0 || result.left + result.right + result.gap * 4 >= 1) fail('Board crop must fit the image.');
        return { position: Number(c.position), ...result };
      });
      if (crops.map(c => c.position).sort().join(',') !== '1,2,3,4,5') fail('Board crop positions must be 1–5.');
      return { id, name, mode: 'board', image: item.image, crops };
    }
    fail('Template mode must be slides or board.');
  });
}
export async function templateImportRoute(request, env, accountId, url) {
  const parts = url.pathname.split('/').filter(Boolean), method = request.method;
  if (parts.length === 2 && method === 'POST') {
    const clientId = url.searchParams.get('clientId'), client = await getClient(env, accountId, clientId);
    if (!client) fail('Client not found.', 404);
    if (url.searchParams.get('scope') !== 'client' || url.searchParams.get('businessPackId') !== client.businessPackId) fail('Choose this client’s business type.');
    const bytes = new Uint8Array(await request.arrayBuffer()), data = preview(unpack(bytes), client.businessPackId);
    const id = crypto.randomUUID(), key = `${accountId}/${clientId}/template-imports/${id}.zip`;
    await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: 'application/zip' } });
    try { await env.DB.prepare('INSERT INTO template_imports(id,account_id,client_id,business_pack_id,status,object_key,preview_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id, accountId, clientId, client.businessPackId, 'staged', key, JSON.stringify(data), stamp(), new Date(Date.now() + 86_400_000).toISOString()).run(); }
    catch (error) { await env.ASSETS.delete(key); throw error; }
    return Response.json({ id, preview: data }, { status: 201 });
  }
  const row = await read(env.DB, 'SELECT * FROM template_imports WHERE account_id=? AND id=?', accountId, parts[2]);
  if (!row) fail('Template import not found.', 404);
  if (row.status !== 'staged') fail('Template import is no longer editable.', 409);
  const object = await env.ASSETS.get(row.object_key);
  if (!object) fail('Staged ZIP is unavailable.', 404);
  const files = unpack(new Uint8Array(await object.arrayBuffer()));
  const data = JSON.parse(row.preview_json);
  if (parts.length === 3 && method === 'PATCH') {
    const patch = await request.json();
    if (patch.packId) data.packId = String(patch.packId).slice(0, 80);
    if (patch.version) data.version = String(patch.version).slice(0, 40);
    if (patch.templates) data.templates = checkedTemplates(patch.templates, files);
    data.unresolved = false;
    await env.DB.prepare('UPDATE template_imports SET preview_json=? WHERE account_id=? AND id=?').bind(JSON.stringify(data), accountId, row.id).run();
    return Response.json({ preview: data });
  }
  if (parts.length === 4 && parts[3] === 'install' && method === 'POST') {
    const manifest = data.manifest, templates = checkedTemplates(manifest?.templates || data.templates, files);
    const packId = String(manifest?.id || data.packId || 'imported').slice(0, 80), version = String(manifest?.version || data.version || '1.0.0').slice(0, 40);
    if (!/^[a-z0-9-]{1,80}$/.test(packId) || !/^[a-zA-Z0-9.-]{1,40}$/.test(version)) fail('Invalid pack ID or version.');
    const installed = [];
    for (const item of templates) {
      const id = `${packId}:${item.id}:${version}:${row.client_id}`;
      if (await read(env.DB, 'SELECT id FROM templates WHERE id=?', id)) fail('This template version is already installed. Use a new version.', 409);
      const refs = item.mode === 'slides' ? item.slides.map(s => s.image) : [item.image];
      const assets = [];
      for (const name of refs) assets.push(await saveAsset(env, accountId, row.client_id, { kind: 'template-reference', name, mime: imageMime(files[name]), bytes: files[name] }));
      const templateData = item.mode === 'slides' ? { slides: item.slides.map((s, i) => ({ position: s.position, assetId: assets[i].id })) } : { assetId: assets[0].id, crops: item.crops };
      await env.DB.prepare('INSERT INTO templates(id,account_id,client_id,name,business_pack_id,mode,data_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, accountId, row.client_id, item.name, row.business_pack_id, item.mode, JSON.stringify(templateData), stamp()).run();
      installed.push({ id, name: item.name });
    }
    await env.DB.prepare("UPDATE template_imports SET status='installed' WHERE account_id=? AND id=?").bind(accountId, row.id).run();
    await env.ASSETS.delete(row.object_key);
    return Response.json({ ok: true, templates: installed });
  }
  fail('API route not found.', 404);
}
