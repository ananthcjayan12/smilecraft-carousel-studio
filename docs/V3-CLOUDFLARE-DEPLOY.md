# Deploy Carousel Studio v3 to Cloudflare

Pushes to `v3` run [Deploy v3 to Cloudflare](../.github/workflows/deploy-cloudflare.yml). It creates or reuses D1, a private R2 bucket, a generation Queue and a dead-letter Queue; applies migrations; uploads secrets; deploys the Worker with the browser app; and checks the sign-in gate. The older `v.a.1` branch remains intact. Payments are deferred: the owner assigns plans and their monthly credits manually.

## One-time configuration

1. In Cloudflare, enable Workers, R2 and Queues for the account and configure a `workers.dev` subdomain. Create an account-scoped API token with Workers Scripts: Edit, D1: Edit, R2 Storage: Edit, Queues: Edit, and Account Settings: Read. Cloudflare may require billing details for R2.
2. In GitHub **Settings → Secrets and variables → Actions**, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository or `production` environment secrets. Add `OPENAI_API_KEY` and/or `GEMINI_API_KEY` as secrets. These are owner keys; users never enter provider keys.
3. Google Cloud project `carousel-studio-v3-20260928` and its **Web application** OAuth client have been created. The authorized origin is `https://carousel-studio-v3.ananth-c-jayan.workers.dev` and redirect URI is `https://carousel-studio-v3.ananth-c-jayan.workers.dev/api/auth/google/callback`. Copy its client ID and client secret from the private file `/Users/ananthu/Downloads/carousel-studio-v3-secrets.txt` into GitHub secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The OAuth app is currently in Testing with `ananth.c.jayan@gmail.com` added as a test user. Complete Google Auth Platform branding and publish it before inviting other users. The deploy workflow uploads both values as Worker secrets. `/health` reports `signInConfigured` without exposing them.
4. Set GitHub variable `ADMIN_EMAIL` to the verified Google email of the person who will allocate plans and credits. Optionally set `WORKER_NAME`, `D1_DATABASE_NAME`, `R2_BUCKET_NAME`, `QUEUE_NAME`, `DEAD_QUEUE_NAME`, and `APP_ORIGIN`. Defaults use `carousel-studio-v3-*` and auto-discover the `workers.dev` URL. If setting `APP_ORIGIN`, use the exact HTTPS origin with no trailing slash. Keep resource names stable or you will target different storage.

Run the workflow on `v3` or push to that branch. The workflow summary prints the app URL. `/` redirects visitors to Google sign-in; after sign-in each user receives a private workspace with an `access` plan and zero credits. Drafting costs 2 credits, rewriting 1, and generating or regenerating one image 10. Editing, review and export are free. Failed jobs release their reserved credits. These credit prices and plan allocations are initial values to adjust after measuring provider bills.

## Assign a plan and credits

`access` has 0 monthly credits, `starter` has 100, and `pro` has 500. There is no payment provider or automatic renewal yet. The admin allocates credits once for each calendar month by calling the account-scoped admin API from an authenticated browser session. In the browser console while signed in as `ADMIN_EMAIL`:

```js
const me = await (await fetch('/api/me')).json();
const accounts = await (await fetch('/api/admin/accounts')).json();
console.table(accounts.accounts);
const accountId = 'PASTE_ACCOUNT_ID';
const result = await fetch(`/api/admin/accounts/${accountId}/allocate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf },
  body: JSON.stringify({ planId: 'starter', period: '2026-09' })
});
console.log(await result.json());
```

Replace the month and plan as needed. Repeating the same account/month request cannot grant credits twice. The account holder sees the assigned plan and available credits in Settings. Credits currently carry forward; there is no automatic expiry. Configure the Google sign-in secrets and `ADMIN_EMAIL` before inviting users.

## Local verification

```sh
npm ci
npm test
npm run cloudflare:check
npx wrangler d1 migrations apply DB --local --config wrangler.json
npx wrangler dev --config wrangler.json
```

The local Worker without OAuth secrets shows its sign-in setup page. The hosted workflow reads secrets from GitHub Actions; `npm start` is a separate localhost-only Node prototype. The hosted app supports private reference image uploads, five-slide and manifest design ZIPs, editable project JSON backup/import, and the ten original dental design references. The hosted Worker uses its owner-managed OpenAI and Gemini API keys; local CLI providers remain specific to the localhost prototype.

Official references: [Workers static assets](https://developers.cloudflare.com/workers/static-assets/binding/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Queues](https://developers.cloudflare.com/queues/get-started/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
