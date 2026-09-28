import { readFile, appendFile } from 'node:fs/promises';
const { origin } = JSON.parse(await readFile('.cloudflare-state.json', 'utf8'));
let lastError;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(15000) });
    const result = await health.json();
    if (!health.ok || result.service !== 'carousel-studio-v3' || result.ready !== true) throw new Error('Cloud app health failed.');
    const api = await fetch(`${origin}/api/clients`, { signal: AbortSignal.timeout(15000) });
    if (api.status !== 401) throw new Error('Private customer API was exposed.');
    const home = await fetch(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (home.status !== 302 || !home.headers.get('Location')?.endsWith('/login')) throw new Error('Unauthenticated home did not redirect to sign-in.');
    const login = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(15000) });
    if (!login.ok || !(await login.text()).includes('Your creative workspace')) throw new Error('Sign-in page was not served.');
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
if (lastError) throw lastError;
const summary = 'Cloud app health, private API gate, and sign-in page passed.';
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
console.log(summary);
