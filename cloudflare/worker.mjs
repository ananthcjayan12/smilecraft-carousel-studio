// Safe bootstrap Worker. Replace with the account-scoped API before serving the studio.
const unavailable = () => Response.json({ error: 'The v3 customer API is not launched.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return Response.json({ service: 'carousel-studio-v3-bootstrap', ready: false, providersConfigured: { openai: Boolean(env.OPENAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY) } }, { headers: { 'Cache-Control': 'no-store' } });
    if (pathname.startsWith('/api/') || pathname === '/api') return unavailable();
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Carousel Studio v3</title><body style="font:16px system-ui;max-width:42rem;margin:10vh auto;padding:1rem"><h1>Carousel Studio v3</h1><p>The web service is being prepared. Sign-in, private workspaces and credits will be enabled before launch.</p></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  },
  async queue(batch) {
    // No jobs can enter the bootstrap API. Do not silently acknowledge unexpected work.
    batch.retryAll();
  }
};
