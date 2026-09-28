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
    assert.match(result.image, /^data:image\/png;base64,/);
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
