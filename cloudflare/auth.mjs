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
// Demo sign-in (hackathon/pitch use): off unless DEMO_LOGIN=on. It only opens users seeded with
// identity_provider='demo'; it never creates accounts. DEMO_PASSWORD is required unless unset or 'any'.
export const demoLoginEnabled = env => env.DEMO_LOGIN === 'on';
export const demoKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function matchDemoUser(users, name) {
  const key = demoKey(name);
  if (key.length < 3) return null;
  return users.find(u => demoKey(u.identity_subject) === key) || (key.length >= 4 ? users.find(u => demoKey(u.identity_subject).startsWith(key)) : null) || null;
}
export function loginPage(env, error = '') {
  const configured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), demo = demoLoginEnabled(env);
  const safe = String(error).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#5a50be"><title>Sign in · Srshti</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f7fb;color:#242339;font:15px/1.55 Inter,"Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{display:grid;grid-template-columns:1.05fr 1fr;width:min(100%,980px);min-height:560px;background:#fff;border:1px solid #e8e8f1;border-radius:24px;overflow:hidden;box-shadow:0 25px 70px rgba(18,62,56,.10)}.story{padding:46px 50px;background:linear-gradient(145deg,#5a50be,#8b7ce0);color:#fff;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:11px;font-size:16px;font-weight:800}.mark{display:grid;place-items:center;width:37px;height:37px;border-radius:11px;background:#efedff;color:#6960dc;font-size:21px}.brand em{font-style:normal;color:#e0d9ff}.story-copy{margin:auto 0}.eyebrow{color:#ddd5ff;font-size:10px;font-weight:850;letter-spacing:.15em}.story h1{max-width:460px;margin:14px 0 16px;font-size:clamp(36px,4vw,49px);line-height:1.06;letter-spacing:-.055em}.story p{max-width:400px;margin:0;color:#ece8ff;font-size:14px;line-height:1.7}.story-foot{font-size:11px;color:#e0d9ff}.signin{display:flex;flex-direction:column;justify-content:center;padding:58px 62px}.signin .eyebrow{color:#6960dc}.signin h2{margin:12px 0 10px;font-size:32px;letter-spacing:-.045em;line-height:1.15}.signin p{margin:0 0 24px;color:#777b90}.button{display:flex;align-items:center;justify-content:center;gap:12px;min-height:51px;padding:12px 18px;border-radius:10px;background:#6960dc;color:#fff;text-decoration:none;font-size:13px;font-weight:800;box-shadow:0 7px 17px rgba(8,124,120,.19)}.button:hover{background:#544cca}.button:focus-visible{outline:3px solid #76c5b3;outline-offset:3px}.signin small{display:block;margin-top:20px;color:#9995b0;font-size:11px}.error,.setup{padding:12px 14px;border-radius:9px;background:#fff0ec;color:#9a4737!important;font-size:12px}.setup{background:#f2f7f2;color:#4f6c62!important}.demo{display:grid;gap:10px;margin-top:22px;padding-top:20px;border-top:1px solid #ececf4}.demo label{display:grid;gap:5px;font-size:11px;font-weight:800;color:#5c5a72}.demo input{min-height:44px;padding:10px 12px;border:1px solid #dcdbe8;border-radius:9px;font:inherit;color:inherit}.demo input:focus-visible{outline:3px solid #b8b0f2;outline-offset:1px;border-color:#6960dc}.demo button{border:0;cursor:pointer;font:inherit}.demo .button{background:#242339;box-shadow:none}.demo .button:hover{background:#3a3856}@media(max-width:740px){body{padding:0;display:block}.shell{display:flex;flex-direction:column;min-height:100vh;border:0;border-radius:0}.story{min-height:330px;padding:26px}.story-copy{margin:40px 0 30px}.story h1{font-size:36px}.story-foot{display:none}.signin{padding:37px 26px 55px}.signin h2{font-size:28px}}
  </style></head><body><main class="shell"><section class="story"><div class="brand"><span class="mark" aria-hidden="true">✦</span><span>srshti <em>studio</em></span></div><div class="story-copy"><span class="eyebrow">YOUR CLINIC’S CONTENT STUDIO</span><h1>Your clinic’s content.<br>Ready every week.</h1><p>Branded carousels, posts and stories. Thoughtfully planned and ready for your review.</p></div><span class="story-foot">Set up once. Review in minutes.</span></section><section class="signin"><span class="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Continue with your clinic’s weekly content.</p>${safe ? `<p class="error" role="alert">${safe}</p>` : ''}${configured ? '<a class="button" href="/api/auth/google/start">Continue with Google <span aria-hidden="true">→</span></a>' : demo ? '' : '<p class="setup" role="status">Sign-in is being set up. Please contact your workspace owner.</p>'}${demo ? '<form class="demo" method="post" action="/api/auth/demo"><span class="eyebrow">DEMO CLINIC</span><label>Clinic name<input name="clinic" autocomplete="username" placeholder="e.g. Rosebay" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button" type="submit">Open demo workspace <span aria-hidden="true">→</span></button></form>' : ''}<small>Your work stays connected to your account.</small></section></main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
  if (url.pathname === '/api/auth/demo' && request.method === 'POST') {
    const back = message => Response.redirect(`${env.APP_ORIGIN}/login?error=${encodeURIComponent(message)}`, 302);
    if (!demoLoginEnabled(env)) return json({ error: 'Demo sign-in is not enabled.' }, 404);
    if (request.headers.get('Origin') !== env.APP_ORIGIN) return json({ error: 'Not authorized.' }, 403);
    const form = await request.formData().catch(() => null);
    // Pasted secrets often carry stray whitespace/newlines; demo passwords are not case-sensitive.
    const expected = String(env.DEMO_PASSWORD || '').trim().toLowerCase();
    if (expected && expected !== 'any' && String(form?.get('password') || '').trim().toLowerCase() !== expected) return back('That demo password is not correct.');
    const { results } = await env.DB.prepare("SELECT id,identity_subject FROM users WHERE identity_provider='demo'").all();
    const user = matchDemoUser(results, form?.get('clinic'));
    if (!user) return back('No demo clinic matches that name.');
    const token = random(), csrf = random();
    await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await digest(token), user.id, csrf, Date.now() + 86400000).run();
    return new Response(null, { status: 302, headers: { Location: `${env.APP_ORIGIN}/`, 'Set-Cookie': cookie('cs_session', token, 86400, secure), 'Cache-Control': 'no-store' } });
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
