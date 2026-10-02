# Studio performance fixes

Deployed worker version: `b098b7d6-0ff9-4a92-9059-eb6ba3e1cbb8`.

## Findings and changes

- The public homepage performed a session database lookup before serving HTML. It now serves directly through the static asset binding; private API authentication and administrator restrictions remain enforced.
- Startup fetched identity and bootstrap separately, then refreshed the clinic before rendering. Bootstrap now includes identity and can include the selected clinic, styles and jobs. Pages load only the data they need.
- Every clinic profile save refreshed the full clinic first. Saves now use the current revision and refresh/retry only after a revision conflict, including a website import completing in the background.
- Weekly planning repeated history, style and provider checks for each item and read newly inserted content back unnecessarily. A comparison against the original implementation measured **57 queries before and 24 after** for a new seven-item plan. Topic selection remains sequential and produces seven distinct topics.
- Browser modules formed a request waterfall, including downloads when entering a new page. `scripts/build-web.mjs` produces one approximately 64 KB minified browser module. Startup, tests and Wrangler builds generate it automatically.
- CSS imported fonts from a third-party stylesheet. The fonts and their licenses now live in `web/v4/fonts` and retain `font-display: swap`.
- Worker [Smart Placement](https://developers.cloudflare.com/workers/configuration/placement/) is enabled for database-dependent requests; the homepage stays on the static asset path.
- Overlapping fresh GET requests are deduplicated. API mutation invalidation and clone isolation remain covered by regression tests.
- Private API responses expose `Server-Timing` for authentication and application work. `/health` exposes database time. The browser logs the startup request timing without request bodies or credentials.

## Verification

- Full suite: **163 passed**, using `node --test --test-concurrency=4 tests/*.test.mjs scripts/cloudflare/*.test.mjs`.
- Production Wrangler dry run passed; deployment completed with the existing database, bucket, queues, administrator and origin settings.
- Remote database has no unapplied migrations.
- Chrome verified the bundled module, saved clinic details, clinic setup entry screen, weekly view and settings. No console errors or warnings were observed in the final checks.
- One Chrome startup API sample measured **890 ms**, including **188 ms authentication** and **354 ms application work**. This is a request measurement, not a claim about complete page-load time or a percentile benchmark.
- Two post-deployment health samples took 1,823 ms and 510 ms overall, with database work of 134 ms and 128 ms. A homepage sample took 710 ms. Network latency still varies; these are individual observations.
- The currently signed-in clinic account awaits activation and has zero image credits. Paid style/artwork generation could not be tested live on that account; automated tests cover generation, private media, activation gates and refunds.

One full parallel test run hit the existing local HTTP test's eight-second server-start timeout. That test passed when rerun alone, and the entire suite passed with four concurrent test files. No test timeout was increased.

## Full workflow follow-up

- Weekly planning now prepares its topic choices in memory and persists the week, seven items and seven usage rows in **one atomic 15-statement batch**. The completed week is read in one three-statement batch. Race guards ensure two concurrent requests produce a single complete plan. A failing batch rolls back the week and its items.
- Weekly, review and library reads use D1 batches where available. The latest week is fetched through one browser request, rather than fetching a list and then its first entry. The library gets its week selector and content together.
- Independent weekly jobs now queue in parallel. Concurrent provider-setting reads share one pending query; completed results are not retained as a persistent provider cache. Topic ranking, clinic scoping, provider snapshots and generation priority remain covered by tests.
- Review slide changes reuse the loaded item. Polling explicitly refreshes that item; mutations invalidate the cached revision, and entering a review route clears the previous review state. Opening review includes clinic styles needed for editing.
- Local startup duplicated synchronous CLI version/authentication discovery in separate modules. Discovery results now share a 30-second cache, and explicit refresh can bypass it. The final full suite's local HTTP startup test passes without changing its timeout.
- The deployment smoke check now checks the bundled browser entry point. The live health, private API gates and sign-in checks passed.
- Chrome exercised clinic creation, simulated website import, goals, profile confirmation, three styles, weekly planning, full-week generation, review and slide switching in an isolated in-memory test server. Library and standalone post creation, copy approval and artwork creation were also checked against the final implementation.
- These isolated workflow tests use **simulated AI responses and artwork**. They verify application orchestration and rendering without billing or editing the real clinic account; they do not benchmark external AI providers.
- Isolated observed render samples: clinic details 5 ms, slide switch 2 ms, library 42 ms, create form 137 ms and standalone artwork review 22 ms. These are single local samples, not production performance guarantees.
- Final automated suite: **163 passed**. Production dry run and deployment passed.

- After the opening page renders, idle preloading warms clinic and library data without blocking startup. The final live Chrome check measured 751 ms for an immediate first library request and 2 ms for a repeated switch within the cache window. These are individual route-render samples, not full-page or percentile benchmarks. Final live smoke checks passed.
