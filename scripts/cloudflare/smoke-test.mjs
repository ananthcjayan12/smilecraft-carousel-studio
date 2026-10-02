import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function smokeTest(origin, { request = fetch, attempts = 8, retryDelayMs = 5000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const health = await request(`${origin}/health`, { signal: AbortSignal.timeout(15000) });
      const result = await health.json();
      if (!health.ok || result.service !== 'srshti-v4' || result.ready !== true) throw new Error('Cloud app health failed.');
      const api = await request(`${origin}/api/clients`, { signal: AbortSignal.timeout(15000) });
      if (api.status !== 401) throw new Error('Private customer API was exposed.');
      const home = await request(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      if(!home.ok || !(await home.text()).includes('/v4/app.js'))throw new Error('The V4 landing page was not served.');
      const v4=await request(`${origin}/api/v4/bootstrap`,{signal:AbortSignal.timeout(15000)});
      if(v4.status!==401)throw new Error('Private V4 clinic API was exposed.');
      const login = await request(`${origin}/login`, { signal: AbortSignal.timeout(15000) });
      const html = await login.text();
      // Check the authentication surface, not marketing copy or its capitalization.
      const signInSection = /<section\b[^>]*class="signin"[^>]*>[\s\S]*?<\/section>/i.exec(html)?.[0] || '';
      const hasSignInControl = signInSection.includes('href="/api/auth/google/start"') || signInSection.includes('class="setup" role="status"');
      if (!login.ok || !login.headers.get('Content-Type')?.includes('text/html') || !hasSignInControl) throw new Error(`Sign-in page was not served (HTTP ${login.status}).`);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.SMOKE_ORIGIN || JSON.parse(await readFile('.cloudflare-state.json', 'utf8')).origin;
  const healthResult = await smokeTest(origin);
  const summary = `Cloud app health, private API gate, and sign-in page passed. Google sign-in: ${healthResult.signInConfigured ? 'configured' : 'MISSING GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET GitHub secrets'}. AI providers: OpenAI ${healthResult.providersConfigured?.openai ? 'configured' : 'missing'}, Gemini ${healthResult.providersConfigured?.gemini ? 'configured' : 'missing'}.`;
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
  console.log(summary);
}
