import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { IMAGE_FORMATS, imageFormat, openaiImageSize } from '../web/image-formats.js';
import { repairGeneration } from '../web/studio-controls.js';
import { buildSlideImagePrompt, generateSlideImage } from '../server/image-providers.mjs';
import { buildV1ImagePrompt } from '../cloudflare/prompts.mjs';
import { resolveBusinessContext } from '../server/business-packs.mjs';
import { finalArtworkBlob } from '../web/canvas.js';

const slide = { approved: true, heading: 'Exact heading', body: 'Exact body', visualPrompt: 'Simple scene' };
const contextSnapshot = resolveBusinessContext({ name: 'Test', businessPackId: 'general', brand: { name: 'Test' } });

test('formats default old projects and constrain invalid saved values', () => {
  assert.equal(repairGeneration().aspectRatio, '4:5');
  assert.equal(repairGeneration({ aspectRatio: 'random' }).aspectRatio, '4:5');
  for (const format of IMAGE_FORMATS) {
    assert.equal(repairGeneration({ aspectRatio: format.ratio }).aspectRatio, format.ratio);
    for (const model of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
      const [w, h] = openaiImageSize(model, format.ratio).split('x').map(Number);
      assert.equal(w % 16, 0); assert.equal(h % 16, 0);
      assert.ok(w * h >= 655360 && w * h <= 8294400);
      assert.ok(Math.max(w, h) / Math.min(w, h) <= 3);
    }
    assert.ok(['1024x1024', '1024x1536', '1536x1024'].includes(openaiImageSize('gpt-image-1', format.ratio)));
  }
});

test('hosted, companion and Node image prompts request the same selected canvas', () => {
  for (const { ratio, width, height } of IMAGE_FORMATS) {
    for (const context of [undefined, contextSnapshot]) {
      const input = { slide, slideNumber: 1, aspectRatio: ratio, contextSnapshot: context };
      const prompt = buildSlideImagePrompt(input);
      assert.equal(prompt, buildV1ImagePrompt(input));
      assert.ok(prompt.includes(`Required output aspect ratio: ${ratio}.`));
      assert.ok(prompt.includes(`${width} × ${height}`));
      if (ratio !== '4:5') assert.doesNotMatch(prompt, /4:5/);
    }
  }
});

test('Node API adapters send selected model-supported dimensions and ratios', async () => {
  const previousFetch = globalThis.fetch, previousOpenai = process.env.OPENAI_API_KEY, previousGemini = process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = 'test'; process.env.GEMINI_API_KEY = 'test';
  try {
    for (const format of IMAGE_FORMATS) {
      for (const model of ['gpt-image-2', 'gpt-image-1', 'gemini-3.1-flash-image']) {
        const provider = model.startsWith('gemini') ? 'gemini' : 'openai';
        globalThis.fetch = async (_url, options) => {
          if (provider === 'openai') {
            assert.equal(options.body.get('size'), openaiImageSize(model, format.ratio));
            assert.ok(options.body.get('prompt').includes(`Required output aspect ratio: ${format.ratio}.`));
            return Response.json({ data: [{ b64_json: 'iVBORw0KGgo=' }] });
          }
          const body = JSON.parse(options.body);
          assert.equal(body.response_format.aspect_ratio, format.geminiRatio || format.ratio);
          return Response.json({ outputs: [{ type: 'image', data: 'iVBORw0KGgo=' }] });
        };
        await generateSlideImage({ provider, model, slide, slideNumber: 1, aspectRatio: format.ratio, referenceImage: 'data:image/png;base64,iVBORw0KGgo=' });
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOpenai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenai;
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
  }
});

test('ZIP image preparation uses selected dimensions without clipping the source', async () => {
  const previousDocument = globalThis.document, previousBitmap = globalThis.createImageBitmap;
  try {
    for (const format of IMAGE_FORMATS) {
      let rect, canvas;
      globalThis.createImageBitmap = async () => ({ width: 1024, height: 1536, close() {} });
      globalThis.document = { createElement() {
        canvas = { getContext: () => ({ fillRect() {}, drawImage(_image, ...args) { rect = args; } }), toBlob(callback) { callback(new Blob(['png'], { type: 'image/png' })); } };
        return canvas;
      } };
      const blob = await finalArtworkBlob(new Blob(['image']), format.ratio);
      assert.equal(blob.type, 'image/png');
      assert.equal(canvas.width, format.width); assert.equal(canvas.height, format.height);
      const [x, y, w, h] = rect;
      assert.ok(x >= 0 && y >= 0 && x + w <= format.width + 1e-8 && y + h <= format.height + 1e-8);
      assert.ok(Math.abs(w / h - 1024 / 1536) < 1e-8);
    }
  } finally { globalThis.document = previousDocument; globalThis.createImageBitmap = previousBitmap; }
});

test('Node format change preserves approved copy, clears artwork and rejects old-format completion', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'carousel-format-store-'));
  const previousRoot = process.env.STORAGE_ROOT; process.env.STORAGE_ROOT = dir;
  const store = await import(`../server/store.mjs?formats=${Date.now()}`);
  try {
    const client = store.createClient({ name: 'Test', businessPackId: 'general' });
    let p = store.createProject(client.id, { generation: { aspectRatio: '1:1' } });
    p = store.saveProject(client.id, p.id, { expectedRevision: p.revision, slides: p.slides.map(s => ({ ...s, approved: true, artworkAssetId: 'old', artworkReviewed: true })) });
    const changed = store.saveProject(client.id, p.id, { expectedRevision: p.revision, generation: { ...p.generation, aspectRatio: '9:16' } });
    assert.ok(changed.slides.every(s => s.approved && !s.artworkAssetId && !s.artworkReviewed));
    assert.equal(changed.generation.aspectRatio, '9:16');
    assert.equal(store.attachArtworkIfCurrent(client.id, p.id, { slideIndex: 0, copyRevision: p.slides[0].copyRevision, aspectRatio: '1:1', templateId: p.templateId, contextHash: createHash('sha256').update(JSON.stringify(p.contextSnapshot)).digest('hex'), assetId: 'stale', provider: 'openai' }), null);
  } finally {
    store.db.close();
    if (previousRoot === undefined) delete process.env.STORAGE_ROOT; else process.env.STORAGE_ROOT = previousRoot;
    await rm(dir, { recursive: true, force: true });
  }
});
