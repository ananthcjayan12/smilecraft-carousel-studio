import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../cloudflare/worker.mjs';
import { smokeTest } from './smoke-test.mjs';

const origin = 'https://smoke.example';
const landingHtml = '<!doctype html><html><head><title>Srshti · Your weekly clinic content studio</title></head><body><div id="app"></div><script src="/v4-core.js"></script></body></html>';
const environment = () => ({
  APP_ORIGIN: origin,
  DB: { prepare: () => ({ first: async () => ({ ready: 1 }) }) },
  STATIC: { fetch: async () => new Response(landingHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) }
});

for (const configured of [true, false]) {
  test(`smoke check accepts the actual Worker login page with Google sign-in ${configured ? 'configured' : 'pending'}`, async () => {
    const env = environment();
    if (configured) Object.assign(env, { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' });
    const result = await smokeTest(origin, { attempts: 1, request: (url, options) => worker.fetch(new Request(url, options), env) });
    assert.equal(result.ready, true);
    assert.equal(result.signInConfigured, configured);
  });
}

test('smoke check rejects an unrelated public landing page', async () => {
  const env = environment();
  await assert.rejects(smokeTest(origin, { attempts: 1, request: (url, options) => new URL(url).pathname === '/'
    ? Promise.resolve(new Response('<html>Your creative workspace</html>', { headers: { 'Content-Type': 'text/html' } }))
    : worker.fetch(new Request(url, options), env) }), /Public landing page was not served \(HTTP 200\)/);
});

test('smoke check rejects a failed response containing the real landing markup', async () => {
  const env = environment();
  await assert.rejects(smokeTest(origin, { attempts: 1, request: async (url, options) => {
    const response = await worker.fetch(new Request(url, options), env);
    return new URL(url).pathname === '/' ? new Response(await response.text(), { status: 503, headers: response.headers }) : response;
  } }), /Public landing page was not served \(HTTP 503\)/);
});

test('smoke check still rejects an exposed private API', async () => {
  const env = environment();
  await assert.rejects(smokeTest(origin, { attempts: 1, request: (url, options) => new URL(url).pathname === '/api/clients'
    ? Promise.resolve(Response.json({ clients: [] }))
    : worker.fetch(new Request(url, options), env) }), /Private customer API was exposed/);
});

test('smoke check retries a transient deployment failure', async () => {
  const env = environment();
  let healthRequests = 0;
  await smokeTest(origin, { attempts: 2, retryDelayMs: 0, request: (url, options) => {
    if (new URL(url).pathname === '/health' && ++healthRequests === 1) return Promise.resolve(Response.json({ ready: false }, { status: 503 }));
    return worker.fetch(new Request(url, options), env);
  } });
  assert.equal(healthRequests, 2);
});
