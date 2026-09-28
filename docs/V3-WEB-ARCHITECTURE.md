# v3: hosted web app with account credits

## Product boundary

`v.a.1` remains the desktop release. `v3` is a separate, web-only branch. The owner supplies and pays the AI provider accounts; customers sign in and pay the product for a defined allowance of generation credits. Customers never enter provider API keys. A client in the creative workspace is a customer's brand, **not** a paying account.

The current branch is a local web prototype. It deliberately refuses a public `HOST` because authentication, tenant ownership and credit enforcement are not implemented yet. Do not put it behind a public reverse proxy either.

## Recommended shape

```text
Browser (login, workspace, credit balance)
  -> authenticated web API (account membership + role)
      -> PostgreSQL (accounts, projects, jobs, credit ledger)
      -> object storage (private images, templates, exports)
      -> durable queue -> AI workers -> owner-managed provider APIs
      -> payment webhooks (verified, idempotent)
```

Use a managed identity provider for email or social sign-in and secure server-side sessions in `HttpOnly`, `Secure`, `SameSite` cookies. Create one **account** per paying customer or team. A user may belong to multiple accounts; each account owns its clients, projects, templates, assets, jobs and credit wallet. Resolve the active account from an authenticated membership on every request. Client IDs and account IDs in URLs are selectors, never proof of permission. Keep ordinary user, account admin and service admin permissions separate. A service admin route should be explicit and audited.

Use PostgreSQL for shared application data and a separate private object store for images. Add `account_id` to every owned table and scope every query and asset authorization by that value. Row-level security can add a second barrier if the database role used by requests cannot bypass it. Existing local SQLite data needs an explicit, one-account-at-a-time import; do not automatically merge existing clients into a shared hosted database.

The browser calls only the product API. Workers use owner-held provider keys from a secret manager. Remove Codex and Antigravity CLI modes from the hosted path. Expose a small owner-curated model catalog and version it with credit prices. Put per-account concurrency, daily spend ceilings and provider-wide limits in the worker scheduler.

## Credits and plans

Define product credits as units for visible actions, not provider tokens. Example starting schedule for testing: draft five-slide copy = 2 credits; revise one slide = 1; generate or regenerate one slide image = 10. Editing, reviewing, downloading and retrying a failed job = 0. These are **illustrative units**, not a price quote. Image generation is the main cost driver, so revise this schedule from actual provider bills, output size, failed-call costs, infrastructure and payment fees before selling plans. Show the credit cost before each paid action.

Offer monthly plans with a fixed credit grant and optional prepaid top-up packs. Keep plan terms explicit: credit expiry, rollover, upgrades, downgrades, refunds and cancellation. Do not grant credits simply because checkout opened or a subscription object was created. For a monthly plan, grant once for each paid billing period after a verified successful payment event. Use the payment provider's customer portal for card and subscription changes. Keep Stripe or another payment processor as the payment source of truth; keep **app credits** in the app ledger, since those are what the API must reserve before generation.

Recommended tables:

| Table | Key fields |
| --- | --- |
| `accounts`, `users`, `memberships` | account ID, identity provider user ID, role |
| `plans`, `subscriptions` | plan version, included credits, payment customer/subscription IDs, period, status |
| `credit_ledger` | account ID, signed amount, type, source ID, expiry, created time; unique `(account_id, source_id)` |
| `credit_reservations` | account ID, job ID, quoted cost, status, expiry; unique `job_id` |
| `generation_jobs` | account ID, project ID, stage, provider/model, status, idempotency key, actual cost |
| `payment_events` | processor event ID unique, processing status, timestamp |

For each generation request, in one database transaction: authenticate membership, verify project ownership and model eligibility, find or create the idempotent job, check spend and balance, and reserve the quoted credits. Enqueue the job through a transactional outbox. A worker settles the reservation once on success; a failure or cancellation releases it once. A retry must reuse the same job/reservation or obtain a fresh reservation explicitly. If provider calls can be billed despite failure, define which failures consume credits in the published terms and account for that in settlement. The balance displayed in UI is settled credits minus active reservations, derived server-side. Never accept a balance, plan or unit price from the browser.

Verify payment webhook signatures against the raw body, store each event ID, and make credit grants unique by paid invoice and period. Events can repeat or arrive out of order; reconcile subscription state from the payment provider when needed. An unpaid, expired or cancelled plan must stop new reservations according to the published grace policy, while completed work remains accessible.

## Migration from current server

1. Add account, membership and role tables; integrate hosted sign-in and sign-out. Every `/api/*` route must either authenticate and authorize or be explicitly public. Remove or protect legacy flat-file and migration routes before opening network access.
2. Migrate `clients`, `projects`, `assets`, `templates`, `jobs` and template imports to account-scoped PostgreSQL. Test two accounts against **every** list, detail, write and asset route. Keep shared built-in templates explicitly global and read-only to customers.
3. Move generated and uploaded files to private object storage. Authorize each asset request before a short-lived download URL. Keep backups, deletion and retention policies tied to accounts.
4. Replace synchronous AI calls in HTTP requests with a durable queue and workers. Record a stable request idempotency key, timeouts, retries and final job state.
5. Implement the credit ledger and reservation transaction. Route **all** text, image and template generation through the same charging gateway; remove old unmetered generation endpoints.
6. Integrate subscription checkout, verified webhooks, account billing page and customer portal. Exercise repeated, delayed and out-of-order events, payment failure, renewal and cancellation in test mode.
7. Add account UI for login, current plan, available/reserved credits, transaction history and an insufficient-credit flow. Choose plan amounts only after measuring real unit economics.
8. After security and billing checks pass, enable public HTTPS hosting, monitoring, backups, rate limits and spend alerts.

Release gates: unauthenticated requests cannot read or mutate tenant data; account A cannot access account B by guessing IDs; concurrent paid requests cannot overspend; duplicated requests and webhooks cannot charge or grant twice; failed jobs release reservations correctly; no browser response contains provider keys or server filesystem paths.

References: [OWASP multi-tenant security guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html), [Stripe usage-based pricing models](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-models), [Stripe events API](https://docs.stripe.com/api/events).
