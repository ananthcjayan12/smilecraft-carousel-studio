import { session, mutationAllowed, loginPage, authRoute } from './auth.mjs';
import { cloudV4 } from './v4.mjs';
import { apiRoute } from './studio.mjs';
import { consumeJob, recoverStaleJobs } from './generation.mjs';
import { companionRoute, expireCompanionJobs } from './companion.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    try {
      if (path === '/health') {
        await env.DB.prepare('SELECT 1').first();
        return json({ service: 'srshti-v4', ready: true, signInConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), providersConfigured: { openai: Boolean(env.OPENAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY) } });
      }
      if (path.startsWith('/api/auth/')) {
        const auth = await authRoute(request, env, url);
        if (auth) return auth;
      }
      const viewer = await session(request, env);
      if (path.startsWith('/api/companion/')) {
        if (viewer && !['GET','HEAD'].includes(request.method) && !mutationAllowed(request,env,viewer)) return json({error:'This request did not pass the session check.'},403);
        return companionRoute(request,env,viewer,url);
      }
      if (path === '/login') return viewer ? Response.redirect(`${env.APP_ORIGIN}/`, 302) : loginPage(env, url.searchParams.get('error') || '');
      if (path === '/') return env.STATIC.fetch(request);
      if (path.startsWith('/api/')) {
        if (!viewer) return json({ error: 'Sign in to continue.' }, 401);
        if (!['GET', 'HEAD'].includes(request.method) && !mutationAllowed(request, env, viewer)) return json({ error: 'This request did not pass the session check. Reload and retry.' }, 403);
        if(path.startsWith('/api/v4/'))return cloudV4(env).route(request,viewer.account_id,url);
        return apiRoute(request, env, viewer, url);
      }
      return env.STATIC.fetch(request);
    } catch (error) {
      console.error('Request failed', error);
      return json({ error: error.status && error.status < 500 ? error.message : 'The service could not complete that request.' }, error.status || 500);
    }
  },
  async scheduled(_event, env) { await recoverStaleJobs(env); await expireCompanionJobs(env); await cloudV4(env).recover(); },
  async queue(batch, env) {
    await Promise.all(batch.messages.map(async message => {
      try { if(message.body?.v4JobId)await cloudV4(env).consume(message.body.v4JobId);else await consumeJob(env, message.body?.jobId); message.ack(); }
      catch (error) { console.error('Queue processing failed', error); message.retry(); }
    }));
  }
};
