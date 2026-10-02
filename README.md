# Srshti Carousel Studio

Create branded clinic carousels, posts and stories, review the artwork, and download images with captions and source references.

## Run locally

Requires **Node.js 22 or newer**.

```sh
npm install
cp .env.example .env
npm start
```

Open **http://127.0.0.1:4178**. Local clinic profiles, styles, projects and artwork persist in `storage/`. You can manage multiple clinics and create real sample packs for clinic pitches. Local use requires no Google sign-in, payment activation or desktop companion.

Install and sign in to **Codex CLI** or **Antigravity CLI (`agy`)**, then open **Settings → Providers**. Refresh status, select the CLI and save. The selected CLI must support image generation in your account. Codex checks installation and login; AGY checks installation and reports authentication/tool failures when generating. The advanced studio at `/legacy.html` supports CLI copy drafting and revision too; V4 weekly copy comes from the curated source library.

API generation is also available: put `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env` and select that provider in Settings. The launcher loads `.env`, with existing process environment values taking precedence. Keys remain on the server. Optional `CODEX_BIN`/`AGY_BIN` configure executable paths; `SRSHTI_LOCAL_PROVIDER` and `SRSHTI_LOCAL_IMAGE_MODEL` set initial defaults. Saved choices override defaults and apply to newly queued jobs.

To move storage, set `STORAGE_ROOT=/absolute/path/to/carousel-storage` in `.env`. Back up the entire directory, including SQLite and asset files. The Node server binds to loopback only.

## Clinic workflow

1. Add a clinic; import its public website or enter details manually.
2. Confirm clinic facts, logo and brand colours.
3. Generate and select clinic styles.
4. Plan the week: two carousels, one post and four stories.
5. Generate artwork, review and edit it, then approve and download the pack.

Scheduling, publishing integrations and payment checkout are deferred. See the [V4 launch guide](docs/V4-LAUNCH.md) for implementation details and limits.

## Cloud

Cloud V4 uses Google sign-in, private D1/R2 storage, queued API generation and manually allocated plans. Codex/AGY provider selection belongs to the local version. Cloud V4 does not require CLI installation or companion pairing.

Follow the [Cloudflare deployment guide](docs/V3-CLOUDFLARE-DEPLOY.md) and [V4 launch guide](docs/V4-LAUNCH.md) for configuration, migrations and release checks. The legacy advanced studio retains its earlier companion implementation.

## Development checks

```sh
npm test
npm run cloudflare:check
```

### Content writing and custom content

V4 prepares language-aware briefs, then writes content using the selected template image and the v3 prompt guidance. Weekly drafts are validated and approved automatically before artwork generation. Standalone carousels, stories and posts require copy review and approval. **Create content** accepts custom briefs; weekly pieces can also use your own brief. **Settings → Providers** maps a provider and model separately to writing, validation, styles and artwork. Confirm your CTA contacts in **Brand & styles**. Cloud deployment requires migration `0011_v4_content_pipeline.sql`; local startup applies it automatically.

The V4 browser app is bundled by `npm run web:build`. Local startup, tests and Wrangler deployment run this build automatically. Fonts are served locally; private API responses include `Server-Timing` headers for diagnosing session and application latency.
