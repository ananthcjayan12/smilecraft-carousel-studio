# Multi-business implementation log

Implementation target: `v1.multi`.

## Implemented first-release scope

- Five versioned business packs: dental, tour operator, salon, construction and general business.
- Business-neutral context resolver with exact brand/contact handling, language policy, recipe roles, CTA policy and pack-specific factual restrictions.
- SQLite metadata (`better-sqlite3` on Node 20; Node 22 development fallback uses `node:sqlite`) plus file-backed private assets.
- Client CRUD/profile revisions, client-scoped projects, optimistic project revisions, explicit apply-latest-client-settings, dashboard and all-project summaries.
- Project snapshots pin client/business-pack context until explicitly refreshed.
- Private/shared template metadata and built-in neutral five-slide starter references for every business type.
- Staged ZIP importer supporting STORE and DEFLATE, optional manifest, image-only mapping, legacy SmileCraft board recognition, CRC/signature/dimension checks, path/symlink/encryption/compression/expansion validation, immutable version conflicts and idempotent identical imports.
- Durable job records with queued/running/succeeded/failed/interrupted/superseded lifecycle, request idempotency keys, provider queues and revision-safe image result attachment.
- Existing Codex/OpenAI/Gemini/Claude/Antigravity text adapters and OpenAI/Gemini/Codex/Antigravity image adapters retained.
- Approval-first five-slide workflow with explicit artwork review required for export.
- Portable ZIP export embeds generated artwork, logo and selected template references; project JSON import remaps asset IDs into a selected target client.
- Legacy flat-file API compatibility plus dry-run/backed-up migration. Legacy projects with different stored brands are mapped to separate clients; data-URL artwork/logo/custom references are copied into managed assets.
- Agency UI: Overview, Clients, All Projects, Shared Templates, Workspace Settings, partial onboarding/profile editing, client workspace tabs and Topic → Content → Design → Review → Export studio flow.
- 1080 × 1350 PNG output and editable caption/project files retained.

## Local verification

- `node --check` on new server/frontend modules: pass.
- `node --test tests/multi-business.test.mjs tests/template-import.test.mjs`: 8/8 pass.
- Legacy dental prompt/parser compatibility assertions: pass.
- Legacy flat-file HTTP smoke checks: pass.
- Scoped HTTP test verifies five packs, two client creation, cross-client project denial, stale revision conflict and dashboard counts.

## Operational notes

- Run `npm install` after updating because the multi-business metadata layer adds `better-sqlite3`; `sharp` is used when available for enlarged master-board crop references.
- Production/local Node 20 uses the declared SQLite driver. The Node 22 built-in fallback exists only so development/test environments without installed dependencies can still exercise metadata behavior.
- API keys remain server-side. This release is still a local unauthenticated workspace and must not be exposed publicly without authentication and a security review.
