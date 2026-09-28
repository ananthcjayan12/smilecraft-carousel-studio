import { session, mutationAllowed, loginPage, authRoute } from './auth.mjs';
import { apiRoute } from './studio.mjs';
import { consumeJob, recoverStaleJobs } from './generation.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === '/health') {
        await env.DB.prepare('SELECT 1').first();
        return json({ service: 'carousel-studio-v3', ready: true, signInConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), providersConfigured: { openai: Boolean(env.OPENAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY) } });
      }
      if (path.startsWith('/api/auth/')) {
        const auth = await authRoute(request, env, url);
        if (auth) return auth;
      }
      const viewer = await session(request, env);
      if (path === '/login') return viewer ? Response.redirect(`${env.APP_ORIGIN}/`, 302) : loginPage(env, url.searchParams.get('error') || '');
      if (path === '/') return viewer ? env.STATIC.fetch(request) : Response.redirect(`${env.APP_ORIGIN}/login`, 302);
      if (path.startsWith('/api/')) {
        if (!viewer) return json({ error: 'Sign in to continue.' }, 401);
        if (!['GET', 'HEAD'].includes(request.method) && !mutationAllowed(request, env, viewer)) return json({ error: 'This request did not pass the session check. Reload and retry.' }, 403);
        return apiRoute(request, env, viewer, url);
      }
      return env.STATIC.fetch(request);
    } catch (error) {
      console.error('Request failed', error);
      return json({ error: error.status && error.status < 500 ? error.message : 'The service could not complete that request.' }, error.status || 500);
    }
  },
  async scheduled(_event, env) { await recoverStaleJobs(env); },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { await consumeJob(env, message.body?.jobId); message.ack(); }
      catch (error) { console.error('Queue processing failed', error); message.retry(); }
    }
  }
};
