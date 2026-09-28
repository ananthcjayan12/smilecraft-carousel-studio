import { readFile, appendFile } from 'node:fs/promises';
const { origin } = JSON.parse(await readFile('.cloudflare-state.json', 'utf8'));
let lastError;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(15000) });
    const result = await health.json();
    if (!health.ok || result.service !== 'carousel-studio-v3-bootstrap' || result.ready !== false) throw new Error('Bootstrap health failed.');
    const api = await fetch(`${origin}/api/clients`, { signal: AbortSignal.timeout(15000) });
    if (api.status !== 503) throw new Error('Unfinished customer API was exposed.');
    lastError = null;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
if (lastError) throw lastError;
const summary = 'Bootstrap health passed; unfinished customer API remains unavailable.';
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
console.log(summary);
