import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleBoard } from '../../cloudflare/style-maker.mjs';

const logo = `data:image/png;base64,${Buffer.from('logo').toString('base64')}`;
const client = { id: 'client-1', name: 'Coastline', brand: {} };
const input = { designId: 'teal-editorial-pro', provider: 'openai', model: 'gpt-image-2', name: 'Coastline', businessType: 'Travel', logoImage: logo };

function setup(providerStatus) {
  const ledger = [];
  const env = {
    OPENAI_API_KEY: 'test-key', APP_ORIGIN: 'https://example.test',
    STATIC: { fetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }) },
    DB: { prepare(sql) { return { bind(...values) { return { async run() { ledger.push({ sql, values }); return { meta: { changes: 1 } }; } }; } }; } }
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(providerStatus === 200 ? JSON.stringify({ data: [{ b64_json: Buffer.from('board').toString('base64') }] }) : '{}', { status: providerStatus, headers: { 'content-type': 'application/json' } });
  return { env, ledger, restore: () => { globalThis.fetch = original; } };
}

test('style generation charges once after validation and returns a board', async () => {
  const { env, ledger, restore } = setup(200);
  try {
    const result = await renderStyleBoard(env, 'account-1', client, input);
    assert.match(result.image, /^data:image\/webp;base64,/);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].values[1], 'account-1');
    assert.match(ledger[0].sql, /style_generation/);
  } finally { restore(); }
});

test('provider failure refunds a charged style generation', async () => {
  const { env, ledger, restore } = setup(500);
  try {
    await assert.rejects(renderStyleBoard(env, 'account-1', client, input), /Image provider rejected/);
    assert.equal(ledger.length, 2);
    assert.match(ledger[1].sql, /style_refund/);
  } finally { restore(); }
});

test('style variation sends clean and annotated client references without fetching dental inspiration', async () => {
  const { env, ledger, restore } = setup(200);
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = sql => sql.startsWith('SELECT id FROM templates') ? { bind(...values) { assert.deepEqual(values, ['account-1','client-1','salon','custom:one']); return {first:async()=>({id:'custom:one'})}; } } : originalPrepare(sql);
  env.STATIC.fetch = async () => { throw Error('Dental inspiration should not be fetched for a variation'); };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.body.getAll('image[]').length, 2);
    assert.equal(options.body.get('size'), '1536x1024');
    assert.doesNotMatch(options.body.get('prompt'), /Required output aspect ratio|Target canvas/);
    assert.match(options.body.get('prompt'), /Slide 3: lighten the marked background/);
    assert.match(options.body.get('prompt'), /remove all red annotation strokes/);
    return Response.json({data:[{b64_json:Buffer.from('variant').toString('base64')}]});
  };
  try {
    const result = await renderStyleBoard(env,'account-1',{...client,businessPackId:'salon'},{...input,logoImage:'',sourceTemplateId:'custom:one',referenceImage:logo,moodImage:logo,revisionNotes:'Slide 3: lighten the marked background',aspectRatio:'1:1'});
    assert.match(result.image,/^data:image\/webp;base64,/);
    assert.equal(ledger.length,1);
  } finally {restore();}
});

test('a missing or another client’s source style is rejected before credits are charged', async () => {
  const {env, ledger, restore} = setup(200);
  const originalPrepare = env.DB.prepare;
  env.DB.prepare = sql => sql.startsWith('SELECT id FROM templates') ? {bind(){return {first:async()=>null};}} : originalPrepare(sql);
  try {
    await assert.rejects(renderStyleBoard(env,'account-1',client,{...input,sourceTemplateId:'other-client-style',referenceImage:logo}), error=>error.status===404);
    assert.equal(ledger.length,0);
  } finally {restore();}
});
