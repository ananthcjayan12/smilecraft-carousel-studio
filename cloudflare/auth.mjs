import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();
const random = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const digest = async value => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};
const challenge = async value => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const cookie = (name, value, maxAge, secure = true) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
const readCookie = (request, name) => request.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function session(request, env) {
  const token = readCookie(request, 'cs_session');
  if (!token) return null;
  const row = await env.DB.prepare('SELECT s.csrf,u.id AS user_id,u.email,m.account_id,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? ORDER BY m.account_id LIMIT 1').bind(await digest(token), Date.now()).first();
  return row || null;
}
export function mutationAllowed(request, env, viewer) {
  return request.headers.get('Origin') === env.APP_ORIGIN && request.headers.get('X-CSRF-Token') === viewer.csrf;
}
export function loginPage(env, error = '') {
  const configured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const safe = String(error).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Carousel Studio</title><style>body{font:16px system-ui;background:#eef7f7;color:#193e43;display:grid;min-height:100vh;place-items:center;margin:0}.card{background:#fff;padding:3rem;border-radius:18px;box-shadow:0 15px 50px #1a4c501c;max-width:420px;margin:1rem}h1{font-size:2rem}.button{display:inline-block;background:#087e85;color:white;text-decoration:none;padding:.85rem 1.3rem;border-radius:10px;font-weight:600}p{line-height:1.6}.error{color:#a53737}</style></head><body><main class="card"><span>CAROUSEL STUDIO</span><h1>Your creative workspace</h1><p>Sign in to manage your clients and make carousels.</p>${safe ? `<p class="error">${safe}</p>` : ''}${configured ? '<a class="button" href="/api/auth/google/start">Continue with Google</a>' : '<p>Sign-in setup is in progress. Please check back soon.</p>'}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export async function authRoute(request, env, url) {
  const secure = new URL(env.APP_ORIGIN).protocol === 'https:';
  if (url.pathname === '/api/auth/google/start' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'Google sign-in is not configured.' }, 503);
    const state = random(), verifier = random(), nonce = random();
    await env.DB.prepare('INSERT INTO oauth_states(state_hash,nonce,verifier,expires_at) VALUES(?,?,?,?)').bind(await digest(state), nonce, verifier, Date.now() + 600000).run();
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: await challenge(verifier), code_challenge_method: 'S256' });
    return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, 'Set-Cookie': cookie('cs_state', state, 600, secure), 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
    try {
      const state = url.searchParams.get('state') || '';
      if (!state || state !== readCookie(request, 'cs_state')) throw new Error('Sign-in state mismatch.');
      const pending = await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING nonce,verifier').bind(await digest(state), Date.now()).first();
      if (!pending) throw new Error('Sign-in expired.');
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code: url.searchParams.get('code') || '', grant_type: 'authorization_code', redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`, code_verifier: pending.verifier }) });
      if (!response.ok) throw new Error('Google sign-in failed.');
      const tokens = await response.json();
      const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: env.GOOGLE_CLIENT_ID, requiredClaims: ['sub', 'nonce', 'email'] });
      if (payload.nonce !== pending.nonce || payload.email_verified !== true || typeof payload.email !== 'string') throw new Error('Google identity verification failed.');
      let user = await env.DB.prepare('SELECT id FROM users WHERE identity_provider=? AND identity_subject=?').bind('google', payload.sub).first();
      if (!user) {
        const userId = crypto.randomUUID(), accountId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare('INSERT INTO users(id,identity_provider,identity_subject,email) VALUES(?,?,?,?)').bind(userId, 'google', payload.sub, payload.email),
          env.DB.prepare('INSERT INTO accounts(id,name) VALUES(?,?)').bind(accountId, String(payload.name || payload.email).slice(0,100)),
          env.DB.prepare('INSERT INTO memberships(account_id,user_id,role) VALUES(?,?,?)').bind(accountId, userId, 'owner'),
          env.DB.prepare("INSERT INTO subscriptions(account_id,plan_id,plan_version,status) VALUES(?,'access',1,'manual')").bind(accountId)
        ]);
        user = { id: userId };
      } else await env.DB.prepare('UPDATE users SET email=? WHERE id=?').bind(payload.email, user.id).run();
      const token = random(), csrf = random();
      await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await digest(token), user.id, csrf, Date.now() + 7 * 86400000).run();
      return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN}/`, 'Set-Cookie': cookie('cs_session', token, 7 * 86400, secure), 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.redirect(`${env.APP_ORIGIN}/login?error=${encodeURIComponent(error.message)}`, 302);
    }
  }
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const viewer = await session(request, env);
    if (!viewer || !mutationAllowed(request, env, viewer)) return json({ error: 'Not authorized.' }, 403);
    const token = readCookie(request, 'cs_session');
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('cs_session', '', 0, secure) });
  }
  return null;
}
