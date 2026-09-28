# v3: low-cost Cloudflare web architecture

This follows the deployment model in `/Users/ananthu/Downloads/postpilot-react/.github/workflows/deploy.yml`: GitHub Actions validates the code, creates or reuses Cloudflare resources, applies migrations, deploys a Worker, and smoke-tests its URL. `v.a.1` remains intact on its own branch.

## Runtime

```text
Browser UI / static assets on Cloudflare Workers
  -> same-origin Worker API (login, account/role checks, credits)
       -> D1 (users, accounts, clients, projects, credit ledger, jobs)
       -> private R2 (logos, template images, artwork, exports)
       -> Cloudflare Queue -> AI consumer Worker -> owner-held provider keys
       -> payment webhook -> D1 subscription and credit grant
```

This replaces the initial PostgreSQL/object-store/worker-service recommendation with PostPilot's simpler Cloudflare pattern. One Worker can serve assets, API requests and Queue jobs at first; split the job consumer later only if load or deploy risk justifies it. D1 holds metadata and small JSON. Large image bytes belong in R2. No always-on server or per-user API credentials are needed. D1, Workers, R2 Standard and Queues have included usage; actual charges rise with AI provider use, image storage and traffic. The free tier is not a spending guarantee. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/).

A **paying account** owns many brand **clients**. Verified login identifies the user; membership identifies which accounts they may access. Every client, project, job and R2 key must be scoped to its account. A URL ID is only a selector. Sign-in should use managed OIDC and secure HttpOnly sessions, following the working pattern in PostPilot; it must allow customers rather than PostPilot's owner email allowlist. The exact identity provider and payment processor can be chosen independently of the Cloudflare infrastructure.

## Credit model

Offer monthly plans with fixed included credits and optional top-ups. Show costs before generation; editing, review and download need no credits. An illustrative starting schedule is 2 credits for a five-slide draft, 1 for revising a slide, and 10 for generating or regenerating a slide image. Validate these numbers against actual provider bills, retry costs and desired margin before selling plans.

Keep an append-only credit ledger in D1. On a generation request, verify the session, account membership, project ownership and active plan. Use a stable idempotency key. Atomically create the job and reserve the quoted credits if the account has sufficient balance; publish a small job ID to the Queue. The consumer reads project data from D1, calls the owner-configured AI provider, stores output in R2 and settles the reservation once. Failure releases it once, under clearly published charging terms. Use a D1 outbox with a retrying scheduled dispatch if direct Queue publication could leave a reserved job unpublished. Repeated requests or webhook events must never grant or charge twice.

A verified successful payment webhook grants each paid period once. Checkout opening or a newly created subscription is insufficient. Keep the payment processor as the source of truth for payments; D1 is the source of truth for app credit usage. Publish plan terms for expiry, rollover, cancellation, failed payments and refunds.

## Deployment already scaffolded

The manual [Cloudflare workflow](../.github/workflows/deploy-cloudflare.yml) runs on `v3`. It creates or reuses one D1 database, one **private** R2 bucket, a job Queue and a dead-letter Queue; applies [D1 migrations](../cloudflare/migrations/0001_accounts_credits.sql); deploys a bootstrap Worker; and checks that unfinished customer APIs return 503. Resource names default to `carousel-studio-v3-*` and can be set by GitHub variables. Provisioning is idempotent and refuses a public R2 bucket. The Worker and API are deliberately gated: deploying this bootstrap does not launch the paid service.

One-time setup remains in the Cloudflare and GitHub dashboards: activate Workers/R2/Queues where required, configure a `workers.dev` subdomain, create a scoped Cloudflare API token, and enter the account ID/token as GitHub secrets. OAuth and payment applications, plus their keys and callback URLs, must be created at the provider. The workflow cannot accept provider terms or create those external accounts for you.

## Migration required before customer launch

1. Port the existing Node/SQLite server to a Cloudflare Worker API using asynchronous D1 queries. `better-sqlite3`, the local filesystem and CLI subprocess adapters cannot be deployed there. Keep the current browser UI, but serve it as Worker static assets after API parity is reached.
2. Finish account-scoped tables for clients, projects, templates and assets. Import existing local data only into a chosen account. Authorize every route and R2 download. Remove the legacy unmetered generation routes.
3. Add OIDC login and secure sessions, then account membership checks and two-account isolation tests. A browser-supplied client or account ID cannot grant access.
4. Implement reservation/settlement, Queue consumer, retries, dead-letter handling, spend limits and provider secrets. Put all AI actions through this path.
5. Add paid checkout/webhook handling, plan UI, balance/history and insufficient-credit flow. Test repeated and out-of-order webhooks and concurrent generation.
6. Replace the bootstrap Worker with the complete app, enable push-triggered production deployment, and change the smoke test to require authenticated app behavior. Back up D1 and R2 independently.

Do not expose the local Node server through a proxy in the meantime. The bootstrap Worker is safe to deploy for resource setup, but it is intentionally a maintenance page. [OWASP's tenant guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) describes the isolation checks required before public launch.
