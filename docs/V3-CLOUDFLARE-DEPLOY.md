# Bootstrap v3 Cloudflare resources from GitHub Actions

The `v3` branch includes a **Deploy v3 to Cloudflare** workflow. It runs automatically on pushes to `v3`, and can also be run manually from GitHub Actions. It provisions D1, a private R2 bucket, a generation Queue and a dead-letter Queue, applies the account/credit schema, and deploys a gated bootstrap Worker. It does not launch the customer app. No Cloudflare resources have been created merely by committing the workflow.

## One-time account setup

1. In Cloudflare, activate Workers, R2 and Queues for the chosen account, configure its `workers.dev` subdomain, and note its 32-character account ID. Cloudflare may request billing details for R2. A workflow cannot accept Cloudflare account terms.
2. Create a Cloudflare API token limited to this account with Workers Scripts: Edit, D1: Edit, R2 Storage: Edit, Queues: Edit, and Account Settings: Read. If using a custom domain, give it only the needed zone route permissions too. Use the exact permission named in any Cloudflare 403 response.
3. In this GitHub repository, open **Settings → Secrets and variables → Actions**. Create repository or `production` environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. In the same **Secrets** area, add your owner-managed `OPENAI_API_KEY` and `GEMINI_API_KEY`. The deploy workflow uploads only these values to Cloudflare as encrypted Worker secrets using Wrangler's `--secrets-file`; it does not write them to `wrangler.json`, D1, R2 or browser code. You can add either provider later and rerun the workflow. A key missing from the first deployment leaves that provider unavailable. Wrangler preserves existing Worker secrets if a later run omits them; removing a key requires deleting the Worker secret in Cloudflare as well. The gated bootstrap's `/health` response reports only whether each key is configured, never its value.
5. Optionally set GitHub variables `WORKER_NAME`, `D1_DATABASE_NAME`, `R2_BUCKET_NAME`, `QUEUE_NAME`, `DEAD_QUEUE_NAME`, and `APP_ORIGIN`. Leave them unset for the `carousel-studio-v3-*` names and auto-discovered `workers.dev` URL. If you set `APP_ORIGIN`, use an HTTPS origin with no trailing slash. Keep resource names stable: changing one selects or creates different storage; it does not migrate old data.

## Run

Push a commit to `v3`, or open GitHub **Actions**, choose **Deploy v3 to Cloudflare**, select branch `v3`, and run it. The workflow validates tests and the Worker bundle, creates or reuses resources, applies remote D1 migrations, deploys the Worker, and checks `/health` plus the gated `/api/clients` route. Its summary prints resource names and the bootstrap URL. Re-running the workflow reuses resources and is safe for additive migrations.

The URL shows a maintenance page while the hosted API is unfinished. The existing studio remains usable locally with `npm start`. See [V3-WEB-ARCHITECTURE.md](V3-WEB-ARCHITECTURE.md) for the porting and release gates. Local Node development uses `OPENAI_API_KEY` and `GEMINI_API_KEY` in its process environment (or run `node --env-file=.env server/index.mjs` with an untracked file); it does not read GitHub Actions secrets automatically. The hosted Worker receives those same named keys through the deployment workflow. Payment secrets will be added as Worker secrets when payment integration is implemented. Never put secret values in GitHub variables, `wrangler.json`, D1, or browser code.

For local infrastructure checks without a Cloudflare account:

```sh
npm ci
npm test
npm run cloudflare:check
```

Cloudflare references: [API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Queues](https://developers.cloudflare.com/queues/get-started/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
