# Multi-business Carousel Studio — implementation plan

Status: ready for an implementation agent. This document is a plan, not a record of completed work.

Design reference: [MULTI-BUSINESS-DESIGN.md](MULTI-BUSINESS-DESIGN.md).

## Instructions for the implementing agent

Implement the steps below in order, keeping the application usable at each milestone. Read applicable repository instructions and inspect current code before editing; file locations below reflect the repository at planning time. Use the checkboxes to record completed work and add verification evidence to an implementation log. Do not mark a step complete merely because its UI exists.

Protect existing user data. Develop migrations against copied fixtures and use a separate test storage directory. Preserve unrelated changes. Do not commit credentials, private client data, generated user artwork, or production storage. Do not deploy or publish as part of this implementation.

Make routine implementation choices autonomously within this plan. Document material deviations and unresolved blockers. Paid/live provider calls are not required for automated verification: use mocked adapters and record any live checks separately.

## First-release scope and fixed decisions

- One local agency workspace managing multiple clients; no client login or cloud hosting in this release.
- Five packs: dental clinic, tour operator, salon, construction, and general business. Other clinic specialties must not inherit dental content automatically.
- Five slides per carousel, 1080 × 1350 exported PNGs, existing approval-first workflow and caption/JSON ZIP export.
- Existing master-board plus slide-crop generation method, plus individual slide-reference images.
- Template ZIP upload at onboarding and in the template library, with optional manifest, preview, mapping, ownership and versions.
- Keep Node ESM and the existing frontend initially. Split modules as needed; no framework rewrite or microservices requirement.
- Use SQLite for local metadata and files for assets. Keep storage behind interfaces. Select a driver compatible with the supported Node version, record that choice, and update installation instructions/lockfile. Do not assume built-in SQLite exists on the current Node >=20 baseline.
- API keys stay server-side. Preserve all existing provider adapters and concurrency controls.
- New projects inherit client settings; existing projects pin snapshots until the user explicitly applies updates.

Out of scope: social publishing, billing, video, arbitrary slide counts, client portals, remote multi-user access, and a business-pack visual editor. Adding another industry should require a configuration pack and references, not engine changes.

## Existing code to inspect

| File | Current responsibility / intended change |
|---|---|
| `server/index.mjs` | HTTP routes, flat JSON persistence, fixed pack installation; reduce to routing/bootstrap |
| `server/codex.mjs` | Structured copy schema and dental prompt builder; extract business-neutral prompt composition |
| `server/text-providers.mjs` | Writing providers; preserve transport/parsing while passing resolved context |
| `server/image-providers.mjs` | Image adapters and dental image prompt; generalize prompt/context and reference inputs |
| `server/provider-concurrency.mjs` | Shared provider queues; retain limits and integrate job lifecycle |
| `web/app.js` | Combined state, pages, requests, editing and exports; split navigation, client and studio concerns |
| `web/data.js` | Dental starter topics, identity, roles, captions; move to pack/client configuration |
| `web/design-systems.js` | Ten board definitions, crops and legacy ZIP reader; retain as legacy adapter |
| `web/template-pack.js` | Upload of known boards/logo; replace primary path with generic staged importer |
| `web/canvas.js` | Image optimization/output sizing; preserve final sizing and avoid shrinking imported master originals |
| `web/batch-runner.js`, `web/zip.js` | Batch execution and export; preserve behavior while changing ownership/storage inputs |
| `tests/server.test.mjs`, `tests/concurrency.test.mjs` | Existing behavior checks; retain meaningful coverage and isolate test storage |

Suggested new boundaries: `server/db/`, `server/repositories/`, `server/services/`, `server/routes/`, `server/packs/`, `server/migrations/`, `web/pages/`, `web/studio/`, `web/components/`, `tests/fixtures/`. These are module boundaries, not mandatory naming conventions.

## Step 1 — Capture the baseline and isolate test data

- [ ] Inspect Git status, runtime, scripts and existing tests; record pre-existing failures.
- [ ] Add a configurable storage root and update server tests to use temporary directories, never real `storage/projects/`.
- [ ] Capture synthetic legacy fixtures: ordinary clinic project, changed-brand project, approved slides/artwork, custom reference, missing logo/phone, and old exported JSON.
- [ ] Capture existing dental prompt rules, ten board IDs/crops, five-slide roles, bilingual behavior and export filenames/dimensions.
- [ ] Add an implementation log listing steps, changed files, commands run, outcomes and pending checks.

Gate: baseline tests run with isolated storage; clinic behavior and data formats are documented. No migration has touched real data.

## Step 2 — Define domain contracts and pack schemas

- [ ] Define versioned schemas/validators for business packs, clients, project snapshots, slides, template packs, templates, assets and generation jobs.
- [ ] Use explicit `schemaVersion` separately from content pack/template versions.
- [ ] Give every private entity workspace/client ownership. IDs are server generated or validated, never trusted filesystem paths.
- [ ] Define project revision and per-slide copy/artwork revisions, approval/review timestamps and input hashes.
- [ ] Define a single resolver: pack defaults → client preferences → permitted project overrides. Required rules cannot be overridden by freeform client notes.
- [ ] Resolve exact brand, language/script rules, industry facts, recipe roles, CTA policy, caption defaults and template compatibility into a serializable project snapshot.

Minimum project contract: `id`, `workspaceId`, `clientId`, `schemaVersion`, `revision`, `businessPackId/version`, `recipeId`, `contextSnapshot`, `templateId/version`, five slides, captions, generation preferences, timestamps and export history.

Minimum job contract: ID, workspace/client/project/slide ownership, stage, provider/model, immutable inputs or input snapshot reference, input hash, attempt, status, timestamps, result asset IDs and sanitized error.

Gate: invalid/mismatched contracts are rejected; resolver tests prove defaults and overrides without borrowing another client's identity.

## Step 3 — Build metadata and asset persistence

- [ ] Create SQLite schema migrations and repositories for workspace, clients, projects/slides, template packs/templates, assets, jobs and import sessions.
- [ ] Enable foreign keys and transactional writes; enforce unique pack identities/versions per scope and ownership relationships.
- [ ] Store large images as files under the configured storage root. Metadata references asset IDs, with original filename, detected media type, dimensions and checksum.
- [ ] Stage files, then publish completed assets through a recoverable transaction/finalization process. Define cleanup for abandoned staged files and crash recovery; database and filesystem changes are not inherently one transaction.
- [ ] Serve private assets through ownership-aware routes, not a globally exposed static storage folder.
- [ ] Implement optimistic concurrency: saves supply expected revision; stale saves return a conflict rather than last-write-wins.
- [ ] Archive clients/templates by default; do not delete assets still referenced by projects or pack versions.

Gate: repository tests cover restart persistence, conflicts, ownership mismatches and failed writes. API responses/logs never contain credentials.

## Step 4 — Extract the dental pack and generalize the engine

- [ ] Move current dental topics, starter slides, rules, captions and roles out of generic frontend code into `dental` pack configuration.
- [ ] Preserve existing dental defaults and clinical wording; move SmileCraft identity/logo into a client seed/migration record, not the reusable pack.
- [ ] Refactor copy draft/revision prompt composition to consume the same stored context used by image prompt composition.
- [ ] Replace hardcoded dental imagery, “Book an Appointment,” language, hashtags and informational-slide instructions with recipe/pack policy.
- [ ] Keep exact identity handling, missing-contact behavior, structured output validation and provider error handling.
- [ ] Keep drafting as one coherent five-slide request. Keep per-slide revisions and parallel image generation.
- [ ] Return frontend-safe pack configuration through a registry endpoint; do not duplicate industry rules in multiple UI files.

Gate: meaningful existing dental prompt/provider tests pass; synthetic general-business prompts contain no inherited dental/SmileCraft defaults. Text supplied by the user mentioning dentistry is not incorrectly stripped.

## Step 5 — Implement legacy migration and recovery

- [ ] Add a dry-run migration report: projects found, identities found, template/assets found, invalid files and suggested client mapping.
- [ ] Back up legacy JSON and uploaded/reference assets before applying migration. Record backup path and migration version.
- [ ] Seed the existing SmileCraft client. Map projects with differing identities separately or present a mapping screen; never force all records into SmileCraft.
- [ ] Preserve project IDs when possible, brand snapshots, copy approvals, generated images, selected references, captions and timestamps.
- [ ] Import data-URL assets without quality loss. Preserve original ten board metadata and legacy template aliases.
- [ ] Preserve copy approvals but do not invent artwork-review approval if legacy data has no explicit review evidence. Show existing artwork for review, without forcing regeneration.
- [ ] Make reruns idempotent using a migration ledger/source checksums; report malformed records without deleting originals.
- [ ] Document restoring both legacy data and previous application version. Test rollback against a copy.

Gate: migrated fixtures reopen/export with preserved content and image bytes; rerunning does not duplicate clients/assets/projects. Real-data migration waits until fixture rehearsal succeeds.

## Step 6 — Add scoped APIs and client profiles

- [ ] Implement client CRUD/archive, profile/brand settings, partial onboarding saves and profile revisions.
- [ ] Implement scoped project list/create/read/update/archive, asset access, template discovery and explicit “apply latest client settings.”
- [ ] Validate that every project, template, job and private asset belongs to the route's client or is explicitly shared and compatible.
- [ ] Resolve generation inputs server-side from saved records; do not accept browser-supplied ownership or approval flags as proof.
- [ ] Add filtered/paginated workspace project listing and dashboard summaries with client identity attached to every item.
- [ ] Remove or adapt old global write routes so they cannot bypass the new ownership rules. Retain deliberate legacy import adapters only.

Suggested route contracts:

| Route | Behavior |
|---|---|
| `GET /api/business-packs` | Available packs and onboarding schema |
| `GET/POST /api/clients` | List/create clients |
| `GET/PATCH /api/clients/:clientId` | Read/update profile with expected revision |
| `GET/POST /api/clients/:clientId/projects` | List/create client projects |
| `GET/PATCH /api/clients/:clientId/projects/:projectId` | Read/save project with revision checking |
| `POST .../projects/:projectId/apply-client-settings` | Explicit context refresh and invalidation |
| `GET /api/clients/:clientId/templates` | Compatible shared/private templates |
| `POST /api/template-imports` | Upload ZIP and create scoped staging session |
| `PATCH /api/template-imports/:importId` | Confirm metadata, scope, mappings and crops |
| `POST /api/template-imports/:importId/install` | Validate and publish versioned pack |
| `GET /api/clients/:clientId/assets/:assetId` | Resolve permitted asset |
| `POST .../projects/:projectId/jobs` | Enqueue draft/revision/image work |
| `GET .../projects/:projectId/jobs` | Read job status/results |

Scope must come from validated records throughout. This prevents accidental cross-client access inside the local app; it is not a substitute for authentication in a future hosted deployment.

Gate: API tests reject client A reading/writing client B's private resources, including direct ID requests and old routes.

## Step 7 — Implement generic ZIP parsing and staged validation

- [ ] Use a maintained ZIP implementation supporting STORE and DEFLATE. Verify its runtime compatibility during implementation; do not extend the old STORE-only parser into a new security-sensitive archive implementation.
- [ ] Accept raw binary/multipart archive uploads with bounded streaming; avoid inflating ZIPs into base64 JSON.
- [ ] Define documented/configurable compressed, expanded, file-count, per-image and decoded-pixel limits. Verify they admit the existing SmileCraft pack before choosing defaults.
- [ ] Validate paths after normalization; reject traversal, absolute paths, symlinks, duplicate normalized entries, encrypted/unsupported archives and undeclared unsupported content. Ignore common OS metadata.
- [ ] Detect actual PNG/JPEG/WebP signatures and decode to validate dimensions. Retain original full-resolution reference files.
- [ ] Parse and validate optional `pack.json`; paths must reference valid archive images and may not point to remote URLs or executable instructions.
- [ ] Recognize legacy SmileCraft filenames/crops without requiring them for other packs.
- [ ] For image-only ZIPs, propose boards or folder-based five-slide groups. Return unresolved mappings to the UI instead of silently inventing order/crops.
- [ ] Keep uploads staged and invisible to template discovery until the complete pack is valid and installed. Expire abandoned sessions and remove staging files.

Gate: fixture tests cover normal compressed ZIPs, legacy packs, image-only packs, bad signatures, missing slides, invalid crops, traversal and expansion limits. Failures publish no templates.

## Step 8 — Implement pack manifest, versions and installation

- [ ] Define manifest schema and a readable packing guide. The manifest is optional for upload; the importer produces the same normalized representation when absent.
- [ ] Support master-board mode with exactly five normalized `{x,y,width,height}` crop rectangles within bounds, and individual-slide mode with exactly five ordered references.
- [ ] Define pack IDs within a scope and template IDs within a pack. Keep manifest-declared compatibility separate from the server-owned install target; a manifest cannot grant itself shared scope.
- [ ] Detect identical normalized manifest + asset checksums as a repeat import, independent of ZIP ordering/compression.
- [ ] If content differs for the same pack/version, require a new version or a new pack identity; never mutate immutable versions.
- [ ] Publish validated pack metadata and assets using staged/recoverable installation. Unfinished installs remain undiscoverable after restart.
- [ ] Keep old assets while referenced. Archiving a pack hides it for new projects but does not break old projects.
- [ ] Treat optional logo assignment as a separate explicit client-profile update with its own success/error result.

Example optional manifest for one individual-slide template:

```json
{
  "schemaVersion": 1,
  "id": "salon-elegant",
  "version": "1.0.0",
  "name": "Salon Elegant",
  "businessTypes": ["salon"],
  "templates": [{
    "id": "service-story",
    "name": "Service Story",
    "mode": "slides",
    "slideCount": 5,
    "aspectRatio": "4:5",
    "slides": [
      {"position": 1, "image": "elegant/01.png"},
      {"position": 2, "image": "elegant/02.png"},
      {"position": 3, "image": "elegant/03.png"},
      {"position": 4, "image": "elegant/04.png"},
      {"position": 5, "image": "elegant/05.png"}
    ]
  }]
}
```

Gate: duplicate imports are idempotent; updates preserve old project references; failed installations expose neither partial metadata nor assets to the library.

## Step 9 — Build the dashboard, client workspace and onboarding

- [ ] Introduce separate workspace/client/project state and routes. Do not use an unsaved current project's brand as the application's global client profile.
- [ ] Build Overview, Clients, All Projects, Shared Templates and Workspace Settings navigation.
- [ ] Build client cards/list with search/type filter, recent projects, review counts and job activity.
- [ ] Build client detail tabs: Projects, Brand & Business, Templates & Assets, Settings.
- [ ] Implement five onboarding steps: business type, identity, services/audience/language, visual style, review/first project.
- [ ] Only name/type are mandatory for a draft client; save partial progress and offer sensible pack defaults. Display type-specific fields from the schema.
- [ ] Keep active client name/logo visible; project creation always has an explicit client.
- [ ] Preserve pending edits on navigation: flush saves or show a clear recoverable save error. Never transfer old project autosave timers into a newly selected client.

Gate: onboard two clients of the same type, refresh midway, finish each and create independently branded projects. Dashboard summaries reflect saved state.

## Step 10 — Build the ZIP preview and library UI

- [ ] Reuse one importer component in onboarding and client/shared libraries.
- [ ] Show upload/validation progress, template thumbnails, detected format, template names and errors tied to filenames.
- [ ] Allow grouping/reordering individual references and selecting/editing all five board crops with live previews.
- [ ] Default to the active client's private library; make shared business-type selection explicit.
- [ ] Show existing-pack/version conflicts and installation results. Optional logo assignment is visibly separate.
- [ ] Allow setting a compatible installed template as client default and selecting it in existing studio Design step.
- [ ] Replace fixed “10 templates installed” messages with actual compatible pack/template counts.
- [ ] Provide downloadable example archives and the packing guide from the UI.

Gate: a user can import an image-only ZIP without writing JSON, correct ambiguous mappings, install it and select its references for generation.

## Step 11 — Add durable jobs and revision-safe generation

- [ ] Persist job lifecycle: queued, running, succeeded, failed, interrupted, superseded. Persist immutable generation context before enqueueing.
- [ ] Execute jobs through existing provider concurrency controls; keep independent providers and successful slides unaffected by one failure.
- [ ] Capture client/project/slide identity in each callback. UI refreshes consume scoped job results, not whichever project happens to be active.
- [ ] Attach results only if relevant input hash/revision still matches. Different slides completing concurrently must not invalidate one another merely by changing a global project revision.
- [ ] Preserve stale results as noncurrent assets; never replace current approved content/artwork with them.
- [ ] Draft/revision responses remain unapproved. Enforce copy approval before image jobs on the server.
- [ ] On restart mark unfinished jobs interrupted; offer retry without automatic duplicate paid requests. Use request IDs/idempotency keys for repeated enqueue clicks.
- [ ] Resolve board+crop or individual-slide references and exact client logo by asset ID. Crop master references without degrading stored originals.

Gate: mocked tests cover client switching, copy edits during generation, simultaneous slide completion, duplicate clicks, one failed slide, restart and explicit retry.

## Step 12 — Complete approvals, invalidation and portable exports

- [ ] Add explicit artwork-review state tied to the generated asset/input hash; current UI displays review but does not persist that approval separately.
- [ ] Copy edits invalidate affected copy approval/artwork; template changes invalidate artwork; context updates invalidate the appropriate dependent content.
- [ ] Build ready-to-export state from current copy approval, current artwork, and explicit artwork review, not merely presence of five images.
- [ ] Preserve 1080 × 1350 PNG output and caption text files. Use client/project naming for new exports; continue accepting legacy archive/JSON naming.
- [ ] Export self-contained project data: embed referenced assets in portable JSON or provide an explicit bundled-asset format and importer. Do not export local asset IDs alone as a supposedly portable backup.
- [ ] Import requires a target client, preserves original snapshot and remaps asset IDs safely; embedded source ownership cannot authorize access in the destination workspace.
- [ ] Derive dashboard statuses consistently and record exported revision/time so later edits are not falsely shown as the current exported version.

Gate: export/import into a fresh test storage root restores copy, branding, references and artwork with no dependency on the originating installation.

## Step 13 — Deliver the remaining business packs and references

- [ ] Add tour operator, salon, construction and general packs using the same schema; include onboarding fields, example topics, editable starters, default recipe, CTA, captions and reviewer checklist.
- [ ] Preserve Malayalam-English dental defaults; provide explicit language choices/defaults for new clients and use them consistently in starters/prompts/captions.
- [ ] Campaign-specific prices, travel dates, inclusions, testimonials and portfolio claims require supplied facts; omit or request missing facts.
- [ ] Ship at least one usable five-slide starter recipe and compatible reviewed reference design per new pack. More recipes/templates can follow; do not mark a pack complete with broken or dental-branded placeholder references.
- [ ] Use supplied ZIPs or create neutral reference assets through the appropriate image-generation workflow if available. If artwork creation is unavailable, record the exact missing asset deliverable rather than claiming completion.
- [ ] Include a clinic-specific specialty label and route unsupported specialties to an appropriate general setup, never silently to dental rules.

Gate: each pack completes a mocked end-to-end draft → approve → generate → review → export. Inspect prompts/captions for inherited clinic identity and inappropriate industry language; visually inspect actual reference assets.

## Step 14 — Final integration, documentation and handoff

- [ ] Run the complete automated suite after integration; distinguish newly introduced failures from baseline failures.
- [ ] Perform browser checks for the scenarios below, including empty/error/loading states and keyboard-accessible forms.
- [ ] Rehearse backup/migration/rollback with a copy of legacy storage; only then apply the migration to the intended installation with a recoverable backup.
- [ ] Update README, installation/dependency steps, environment example, storage layout, backup instructions, pack guide and screenshots.
- [ ] Remove obsolete global branding/import paths and UI copy only after their deliberate legacy compatibility paths are verified.
- [ ] Deliver a final report listing implemented scope, checks performed, migration result, remaining limitations and any live-provider checks not performed.

Final verification matrix:

| Scenario | Required result |
|---|---|
| Existing clinic project and ten boards | Open correctly; content/assets preserved; no forced regeneration |
| Two salons with different branding | Separate defaults, projects, private packs, jobs and exports |
| Each non-clinic pack | Correct roles/CTA/language; no inherited dental defaults |
| Existing SmileCraft ZIP | Recognized with correct crops and optional explicit logo assignment |
| Compressed image-only ZIP | Preview, grouping/crops, installation and generation work |
| Manifest ZIP / invalid ZIP | Correct mapping / actionable rejection with no partial install |
| Duplicate pack and new version | No duplicate identical import; old projects remain pinned |
| Direct cross-client resource requests | Denied for private resources, including legacy endpoints |
| Brand update | New projects inherit it; old snapshots change only explicitly |
| Edit or client switch during jobs | No stale attachment or cross-client mutation |
| Provider failure/restart | Completed slides retained; interrupted work explicitly retryable |
| Export without current review | Blocked with reason; reviewed current project exports |
| Fresh-install reimport | Assets/context resolve independently of original installation |
| Migration rerun/rollback | No duplicate data; previous installation can be restored |

## Suggested implementation milestones

1. **Foundation and preservation:** steps 1–5.
2. **Client and template backend:** steps 6–8.
3. **Dashboard and onboarding:** steps 9–10.
4. **Generation and export integration:** steps 11–12.
5. **Business packs and release verification:** steps 13–14.

Use focused, reviewable commits when committing is authorized. A milestone is complete only when its gates pass. No separate agent delegation is required by this plan.

## Copyable handoff prompt

> Implement `docs/MULTI-BUSINESS-IMPLEMENTATION-PLAN.md`, using `docs/MULTI-BUSINESS-DESIGN.md` as the architecture reference. Follow the steps and acceptance gates in order, protect existing clinic data and functionality, and include the complete template ZIP upload workflow. Keep an implementation log and update checkboxes only after verification. Continue through all first-release milestones; report concrete blockers and unverified checks honestly. Do not deploy or publish.
