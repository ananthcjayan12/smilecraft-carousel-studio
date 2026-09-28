# Carousel Studio v3 — web-only product branch

This branch starts the web-only successor to `v.a.1`. The original desktop version remains on the `v.a.1` branch. The existing creative workflow runs in a browser; the proposed hosted account, login, subscription and credit system is specified in [`docs/V3-WEB-ARCHITECTURE.md`](docs/V3-WEB-ARCHITECTURE.md) and is not implemented yet.

## What changed

Carousel Studio now manages multiple isolated clients instead of treating one clinic brand as global state. The first release includes five business packs: **Dental, Tour Operator, Salon, Construction, and General Business**. Each pack owns its roles, starter topics, CTA policy, onboarding fields, factual restrictions and reviewer checklist.

Projects pin a serialized client/business context snapshot. Updating a client does not silently rewrite existing projects; use **Apply latest client settings** inside a project when you intentionally want to refresh that snapshot.

Template references can be client-private or shared. The ZIP importer accepts STORE or DEFLATE archives, optional `pack.json`, exactly-five-image archives, legacy SmileCraft master boards, staged mapping, versions and safety limits. See `docs/PACKING-GUIDE.md` or download the guide/example archive from Shared Templates in the app.

## Web-only direction

There is no desktop build or customer API-key form in v3. AI keys are configured by the service owner on the server. For the future hosted service, users will sign in, select a plan, receive credits after payment, and spend those credits on generation. The current local prototype does **not** enforce login, account isolation or credits; it refuses public network binding to prevent accidental exposure. See the architecture document for the migration and launch gates.

## Install and run

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://127.0.0.1:4178`.

The server binds to localhost and rejects non-loopback hosts. Do not expose it through a reverse proxy or tunnel while authentication and credits are unfinished.

### Storage

Metadata is stored in SQLite and large images remain as files. By default both live under `storage/` (ignored by Git). To move storage elsewhere:

```sh
STORAGE_ROOT=/absolute/path/to/carousel-storage npm start
```

Back up the entire storage root together: the SQLite database and asset files reference each other.

## Agency workflow

1. **Clients** → create a draft client with just a name and business type.
2. Complete Brand & Business fields, language, exact contact details and logo when available.
3. Templates & Assets → use the built-in neutral starter or import a private ZIP. Shared Templates can be installed explicitly by business type.
4. Create a project. Its context snapshot is pinned to the current client profile.
5. **Topic** → use an editable starter or generate one coherent five-slide draft.
6. **Content** → edit/rewrite and approve each slide. Any text edit reopens approval and invalidates dependent artwork.
7. **Design** → select a compatible template and image provider. Missing slide images can run concurrently through the shared provider queue.
8. **Review** → explicitly mark each current generated artwork reviewed after comparing rendered text/identity/claims with the approved copy.
9. **Export** → five separate 1080 × 1350 PNGs plus captions and portable `project.json`.

Export is blocked until all five current copy approvals, artworks and artwork reviews are present.

## Providers

Writing: Codex CLI, OpenAI API, Gemini API, Antigravity CLI, Claude API.

Images: OpenAI API, Gemini API, Codex CLI image generation, Antigravity CLI native image generation.

For the current local prototype, set owner-managed provider keys through server environment variables; see `.env.example`. API keys are never stored in browser project data. Hosted v3 will limit provider and model choices through an owner-curated catalog.

## Legacy SmileCraft data

Workspace Settings shows a dry-run legacy discovery report. **Back up & migrate** copies legacy project JSON to `storage/legacy-backup/` before creating new client/project records. Migration is idempotent through a source checksum ledger. Different stored clinic identities are not forced into the SmileCraft client. Existing data-URL artwork, logos and custom references are copied into managed assets. Legacy artwork is shown for review but is not automatically marked artwork-reviewed.

The old flat-file `/api/projects`, `/api/draft`, `/api/revise`, `/api/render-slide`, and `/api/template-pack` behavior remains as a deliberate compatibility adapter.

## Tests

```sh
npm test
```

The branch keeps the original provider/concurrency/server tests and adds `tests/multi-business.test.mjs` for pack isolation, business-neutral prompts, ZIP DEFLATE/traversal handling, SQLite revisions, cross-client access denial, stale writes and scoped HTTP behavior.

See `docs/IMPLEMENTATION-LOG.md` for verification details.
