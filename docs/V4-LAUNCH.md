# Srshti V4 launch

The launch scope follows `SRSHTI_V4_HANDOFF_PACKAGE/SRSHTI_V4_HANDOFF.md`, with scheduling, publishing integrations and payment checkout deferred per the owner’s instruction. Payment collection and account activation are handled by the team.

## Local studio

Requirements: Node.js 22 or newer. Install and sign in to Codex CLI or Antigravity CLI (`agy`) on this computer. CLI image generation requires the corresponding image tool to be available in your CLI account.

```sh
npm install
cp .env.example .env
npm start
```

Open **http://127.0.0.1:4178**. This is the real local studio: clinic profiles, styles, generated images and weekly packs persist in `storage/`. No Google login, account activation or companion pairing is required locally. Back up the complete storage directory together.

In **Settings → Providers**, choose a provider and model separately for content writing, copy validation, style creation and artwork generation, then save. Refresh availability when signing in or changing server keys. Codex readiness checks installation and login; AGY readiness checks installation, with sign-in and native image-tool availability verified during generation. API providers remain available when their server keys are set in `.env`. Changing providers affects new jobs; already queued tasks retain their original provider/model.

The launcher loads `.env`; explicit process environment values take precedence. Optional `CODEX_BIN` and `AGY_BIN` identify executable paths. `SRSHTI_LOCAL_PROVIDER` and `SRSHTI_LOCAL_IMAGE_MODEL` choose initial defaults; saved Settings choices take precedence. Restart after changing environment configuration.

Create a clinic, confirm its facts, generate and choose styles, create a week, review artwork and download the ZIP for your clinic pitch. This flow generates real artwork; no simulated renderer or hackathon mode is included. Knowledge cards supply briefs and evidence. The selected writing provider prepares briefs, slide copy and captions in the clinic’s selected language combination. The writer receives the actual selected template image. The advanced studio at `/legacy.html` also supports CLI copy drafting and revision.

Local hosting accepts loopback addresses only. Cloud V4 exposes the same task mapping with configured server API providers. CLI providers are available locally; no companion pairing is required.

## Implemented launch flow

- Public landing page and Google sign-in; the existing studio is available at `/legacy.html`.
- Website extraction runs while goals are collected. Imported facts remain unverified until the clinic confirms them. Logo upload and manual entry work without a website.
- Three clinic-adapted styles are generated in parallel, with another three available on demand. Primary and up to two supporting styles are explicitly selected. Client styles are private to their clinic. Unselected styles can be removed; historical artwork retains its reference.
- The default weekly pack has two five-slide carousels, one square post and four vertical stories, with captions. Knowledge cards carry NHS source references, facts and engagement angles. Clinic/global usage ranking discourages recent repeated cards, hooks, recipes and pillars.
- Weekly generation writes and validates each piece, automatically approves validated copy, then creates artwork. Weekly users review finished artwork without a separate copy approval step. Individual failed tasks can be retried without recreating finished artwork.
- Create content supports standalone carousels, square posts and vertical stories. Users enter a custom brief and select a reference style. Standalone drafts are validated, then reviewed and explicitly approved before artwork generation.
- Weekly items also accept custom briefs. Copy edits are checked against supplied evidence and confirmed clinic facts; faithful paraphrases and translations are allowed. Weekly edits proceed to artwork after successful validation. Standalone edits need renewed copy approval. Only affected artwork is cleared.
- CTA contact selections use confirmed phone, WhatsApp, full address, website and booking link values. Contacts are stored separately from body copy and rendered verbatim on the final carousel slide or the post/story frame. Website imports collect candidate contacts for clinic confirmation.
- Provider mappings are saved per account, and queued jobs retain their provider/model snapshots. Whole-week approval and ZIP downloads include artwork, captions, briefs, sources, contact selections and review status.
- Private originals, 1000px previews and 400px WebP thumbnails are stored separately. JSON contains asset IDs. Page modules and ZIP export load on demand; list images use lazy thumbnails.
- Admin settings can manually allocate a plan after the team confirms payment. No scheduling or checkout UI is included.

The source library currently contains 12 reviewed cards and three angles each. Cooldowns are ranking penalties, not absolute bans. The AI writer develops the selected brief into complete content using the v3 writing and image prompt guidance. A separate configured validator checks meaning against the supplied evidence and clinic facts. Rejected drafts remain editable and do not generate artwork. Image providers can still render text imperfectly, so artwork must be reviewed before sharing. Instagram handles are saved as clinic context; this release does not scrape or connect Instagram. New weeks are created with **Plan next week**; there is no automatic weekly generation or publishing.

## Cloud deployment

V4 changes are local on branch `v4`; implementation does not mean production has been deployed. Existing production deployment remains restricted to branch `v3` in `.github/workflows/deploy-cloudflare.yml`. Keep that branch gate until the approved V4 changes are merged or deliberately change the release policy.

Use the existing provisioning/deployment workflow. It must apply migrations **0009** (V4 data), **0010** (manual clinic launch plan), and **0011** (writing pipeline, provider mappings and standalone content) before serving V4. The Worker now includes an `IMAGES` binding; Cloudflare image transformations must be available for the account.

Required environment configuration:

- Cloudflare account/token, D1, private R2 and the existing generation queue.
- `APP_ORIGIN` and `ADMIN_EMAIL`.
- Google OAuth client ID/secret, with the existing `/api/auth/google/callback` redirect URI.
- At least one server image provider key. Initial defaults prefer OpenAI when both keys exist; Settings can map each task to another available provider/model. Its defaults are `gpt-image-1` for OpenAI and `gemini-3.1-flash-image` for Gemini. Optional `SRSHTI_IMAGE_MODEL` overrides the default through the GitHub environment/Worker variable.

```sh
npm test
npm run cloudflare:check
npm run cloudflare:prepare
npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.generated.json
npm run cloudflare:deploy
npm run cloudflare:smoke
```

These remote commands change production; run them as part of the approved release. The smoke check verifies the public V4 shell, private V3/V4 API gates, health and Google sign-in surface.

## Manual client activation

1. Ask the clinic owner to sign in with Google and start setup.
2. Collect payment outside the app.
3. Sign in as `ADMIN_EMAIL`, open Settings, find the clinic account and assign **founding-clinic** for the allocation month after confirming payment.
4. Ask the clinic to refresh access in Settings and continue style generation.

The founding-clinic plan grants 900 internal credits. Each style/slide costs 10 credits. A brief costs 1 credit, a full content draft costs 2, and validation costs 1. Three initial styles plus a standard first week cost 208 credits, including briefs and validated writing. Provider choices use the same internal allowance; CLI jobs run through the local CLI account. Allocation for the same account/month is idempotent. Provider failures refund the task debit. Editing unchanged captions does not generate or charge for images. Credits are internal allowances, not a payment integration.

## Validation

The automated suite covers V3 regressions, source validation, account and clinic isolation, automatic weekly copy approval, standalone copy review, parallel frame attachment, partial retry, revisions, private media, provider refunds and canonical social canvas sizes. Cloud image calls are mocked in tests; no paid production generation was performed during verification. Local provider integration is verified with mocked CLI executables; live CLI generation requires a signed-in CLI with image tools. Live Google OAuth and provider generation still require a configured production deployment and a real smoke run.

## Manual review of the new flow

Use Settings → Providers to save task choices, and Brand & styles to confirm language and contact details. Plan a week, customize any brief if needed, then select Create my week. Validated weekly drafts continue directly to artwork. Use Create content to make a standalone carousel, story or post; prepare its brief, write the draft, review the copy and approve it to create artwork. The Content library includes both kinds of content. Local startup applies migration 0011 automatically; cloud deployment must apply it to D1 before serving the updated Worker.

## V5 cloud administration and performance

Cloud users manage their clinic and content. Only the Google account matching `ADMIN_EMAIL` can open **Admin dashboard** (`#/admin`), read or save AI mappings, access Advanced Studio, or allocate client plans. Advanced Studio's HTML, legacy APIs and companion endpoints reject non-admin access. `/legacy.html` must stay in `assets.run_worker_first` so static hosting cannot bypass authorization.

The dashboard saves one shared mapping for writing, validation, styles and artwork in `v4_provider_settings` under `studio-global`. Client-specific old mappings are ignored. Until a global mapping is saved, the configured administrator's previous mapping is used when available, then provider defaults. Already queued jobs retain their snapshots. Local workspaces keep their existing owner-managed settings.

Client account choices display plan and available credits; allocations use the existing monthly, idempotent admin API. Configure `ADMIN_EMAIL` to your own Google sign-in address before deployment.

Apply migration **0012** for polling, review and week-list indexes. Startup and independent database reads run in parallel, week data loads on demand, and library reads run together. Browser GET results are deduplicated and cached for 15 seconds; mutations invalidate them and progress requests bypass the cache. Cached views appear immediately during navigation, with loading feedback for new pages. Background polling uses only the current page's jobs and pauses requests while the tab is hidden. Font connections and common JavaScript modules are preloaded.
