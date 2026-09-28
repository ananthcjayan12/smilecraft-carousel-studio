# Carousel Studio v3 cloud architecture

The `v3` branch follows the inexpensive Cloudflare provisioning pattern in PostPilot's GitHub workflow. The original `v.a.1` desktop branch remains intact. GitHub Actions creates or reuses a D1 database, private R2 bucket, generation Queue, and dead-letter Queue, then applies migrations and deploys one Worker with static browser assets. There is no always-on server or desktop build.

```text
Browser -> Worker static assets and account-scoped API
        -> Google OAuth + HttpOnly session in D1
        -> D1 clients, projects, plans, credit ledger, jobs
        -> private R2 uploads and generated artwork
        -> Queue -> same Worker consumer -> owner OpenAI/Gemini keys
```

Each verified Google user has a private account. The Worker derives the account from its session, checks it on client and project routes, and serves R2 assets only through those checks. Provider keys are uploaded from GitHub Actions secrets to Worker secret bindings; they never enter the browser. The Worker uses a same-origin CSRF header for state-changing requests.

The owner assigns `access`, `starter`, or `pro` manually. Initial monthly grants are 0, 100, and 500 credits. Drafting five slides costs 2 credits, rewriting one costs 1, and creating one image costs 10. The API atomically reserves credits for a queued job; the consumer settles one ledger charge after a successful project update or releases the reservation on failure. A scheduled cleanup releases stale jobs and sessions. A repeated allocation for the same account and month does not duplicate credits. Credit grants currently carry forward. Payments, automatic monthly renewal, top-ups, refunds, and plan pricing are later work; actual provider costs and desired margin should be measured before selling plans.

The browser app currently supports private clients and projects, brand settings and logos, built-in references, AI draft/rewrite/artwork, review, and browser export. Local ZIP design package import and local CLI providers are not available in the hosted Worker. The `npm start` Node prototype remains localhost-only and has a separate store; it is not a production backend or a migration of local data. See [deployment setup](V3-CLOUDFLARE-DEPLOY.md) for Google OAuth and GitHub secrets.

Cloudflare service usage and AI provider requests can incur charges. See [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), and [Queues](https://developers.cloudflare.com/queues/platform/pricing/).
