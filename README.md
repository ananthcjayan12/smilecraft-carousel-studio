# Carousel Studio v3 — web-only product branch

This branch is the web-only successor to `v.a.1`. The original desktop version remains on the `v.a.1` branch. The hosted version follows [PostPilot's Cloudflare pattern](docs/V3-WEB-ARCHITECTURE.md): Worker, D1, private R2 and a Queue. The [Cloudflare deployment guide](docs/V3-CLOUDFLARE-DEPLOY.md) explains the one-time setup and workflow. Customer login and plan credits are implemented in the Worker; payments are deferred.

## What changed

Carousel Studio now manages multiple isolated clients instead of treating one clinic brand as global state. The first release includes five business packs: **Dental, Tour Operator, Salon, Construction, and General Business**. Each pack owns its roles, starter topics, CTA policy, onboarding fields, factual restrictions and reviewer checklist.

Projects pin a serialized client/business context snapshot. Updating a client does not silently rewrite existing projects; use **Apply latest client settings** inside a project when you intentionally want to refresh that snapshot.

Template references can be client-private or shared. The ZIP importer accepts STORE or DEFLATE archives, optional `pack.json`, exactly-five-image archives, legacy SmileCraft master boards, staged mapping, versions and safety limits. See `docs/PACKING-GUIDE.md` or download the guide/example archive from Shared Templates in the app.

## Web-only direction

There is no desktop build or customer API-key form in v3. The hosted Cloudflare Worker serves the browser app with Google sign-in, private D1 workspaces, private R2 assets, queued generation, and plan credits allocated by the service owner. Payments are intentionally deferred. The separate `npm start` Node prototype remains for local development and does **not** enforce hosted account controls; it refuses public network binding. See the [cloud deployment guide](docs/V3-CLOUDFLARE-DEPLOY.md).

For Cloudflare, set `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as GitHub Actions **secrets**. The [deployment workflow](.github/workflows/deploy-cloudflare.yml) runs on pushes to `v3` and uploads them as encrypted Worker secrets; only backend code reads them. The local Node prototype reads provider keys from its own process environment.

## Install and run

Requirements: Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://127.0.0.1:4178`.

The server binds to localhost and rejects non-loopback hosts. Do not expose it through a reverse proxy or tunnel while authentication and credits are unfinished.

### Test the Cloudflare app and companion locally

Use this setup to debug Google sign-in, account settings, pairing, and local Codex or Antigravity generation together. It uses the local Cloudflare Worker and D1 database. The `npm start` Node prototype above has separate storage and does not support the companion account flow. Install [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/) and Node.js 22 to run the companion.

1. In [Google Cloud Console → Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), select the Carousel Studio project and create a **Web application** OAuth client named `Carousel Studio Local`. Add these entries:

   | Setting | Value |
   | --- | --- |
   | Authorized JavaScript origin | `http://localhost:8787` |
   | Authorized redirect URI | `http://localhost:8787/api/auth/google/callback` |

   Save the new client ID and secret. A separate local client leaves the existing production OAuth client and its allowed URLs untouched. If the OAuth app is in Testing, add your Google account under **Google Auth Platform → Audience → Test users**. Keep `localhost` and port `8787` consistent; the redirect URI must match exactly.

2. From the repository root, install dependencies and apply all migrations to the local D1 database:

   ```sh
   npm ci
   npx wrangler d1 migrations apply DB --local --config wrangler.json
   ```

3. Create `.dev.vars` in the repository root with the **local** OAuth client's credentials. This file is ignored by Git. `APP_ORIGIN` is already set to `http://localhost:8787` in `wrangler.json`.

   ```dotenv
   GOOGLE_CLIENT_ID=your_local_client_id
   GOOGLE_CLIENT_SECRET=your_local_client_secret
   ADMIN_EMAIL=your_google_email
   ```

4. Start the Worker in one terminal, then open `http://localhost:8787` and sign in with Google:

   ```sh
   npx wrangler dev --config wrangler.json
   ```

5. In a second terminal, start the desktop companion:

   ```sh
   npm run companion:desktop
   ```

6. In Carousel Studio **Settings**, use the admin control to **Enable companion** for your account. Under **AI on your computer**, create a pairing code. In the companion, enter `http://localhost:8787`, a computer name, and that code, then click **Start companion**. The code expires after five minutes. Install and sign in to the Codex or Antigravity CLI before testing generation. Create a carousel and choose the local provider for writing or images.

For a quick regression check after edits:

```sh
npm test
cargo test --locked --manifest-path apps/companion-desktop/src-tauri/Cargo.toml
```

The Worker terminal shows backend errors; the browser developer tools show web errors. The companion window shows connection and provider status. Local Worker data lives under `.wrangler/` and is separate from deployed accounts and projects.

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

## Companion desktop app (feature gated)

Accounts can be granted access to a local Codex or Antigravity companion by the service administrator in Settings. Enabled users create a five-minute pairing code under **Settings → AI on your computer**, pair the [Smilecraft Companion](apps/companion-desktop/README.md), and select the local CLI for copy or slide image generation. Local generation uses the user's CLI subscription and no Smilecraft credits. Apply `cloudflare/migrations/0006_companion.sql` and `cloudflare/migrations/0007_companion_images.sql` before deploying this Worker version. The companion installer workflow is `.github/workflows/companion-release.yml`.
