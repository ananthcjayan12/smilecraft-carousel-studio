# Content Engine

The Content Engine is SmileCraft's own Instagram workspace at **`/engine/`**. It turns the 100-idea content bank into finished carousels, reels, static posts and stories in your brand style, using the same storage, queue and AI providers as the client studio.

## What is preloaded

- **Brand:** SmileCraft, with product, audience, voice, offer, mascot and nine brand rules (practice not clinic, US/British spelling, no rupee prices, no invented numbers, HIPAA/GDC/AHPRA basics, Hook → Value → SmileCraft → Comment KEYWORD).
- **Content bank:** all 100 ideas from the growth sprint (8 pillars, format, country, hook, what to show, SmileCraft angle, comment keyword).
- **Lead magnets:** the 19 keyword freebies (DEMO, REACTIVATE, BENEFITS, CANDY, YES …). Posts only promise what a magnet lists.
- **Templates:** 11 editable templates — growth, lead-magnet, steal-this-post and relatable carousels; meme and question posts; poll and proof stories; text-on-screen, product-demo and POV reels. Each sets the frame roles, writing instructions, art direction, size and optional style.
- **Daily slots:** the playbook's 7 IST slots label plan items (1 carousel, 2 reels, 4 stories). Nothing auto-publishes.

Everything is editable in the app and stored per brand. *Restore preloaded ideas* and *Restore default templates* bring originals back without touching your own additions.

## How it works

1. **Brand & styles:** upload the logo (colours are detected), edit the brand rules, then create styles from the reference design boards or upload your own template image. The first finished style becomes the default; change it any time.
2. **Content plan:** choose how many of each format, optional pillars and country. The engine picks unused ideas (never-used first, rotating pillars), maps each to its template, and can write and design everything in one run. Or tick exact ideas in the content bank and *Plan & run*.
3. **Pipeline per piece:** write (template + idea + lead magnet + rules, with the style image attached) → validate against the brand rules → approve copy (automatic for plan runs, manual for custom pieces unless ticked) → one image job per frame.
4. **Review:** edit copy (only changed frames lose artwork), rewrite with new template/style/instructions, redo a single frame with a note, copy the caption, hashtags, keyword DM reply, alt text, reel script and story sticker text, approve, mark as posted, download.
5. **Download pack:** a ZIP per plan with numbered images, `caption.txt` and `post.md` (slot, keyword, DM reply, alt text, sticker, script).

Reels produce 9:16 on-screen text cards plus a shot-by-shot script; stories leave room for the poll or question sticker that you add in the Instagram app.

## Providers

The engine reads the same **Settings → Providers** mapping as the client studio (`v4_provider_settings`), and its own *AI settings* page edits that shared mapping.

- **Local** (`npm start`, then open `http://127.0.0.1:4178/engine/`): Codex CLI or Antigravity CLI (`agy`) for writing, validation, styles and artwork, or any API key in `.env`. Files live in `storage/engine-assets`; tables are created on startup.
- **Cloud** (Cloudflare Worker): OpenAI, Gemini and Claude API keys, D1, private R2, the image binding and the existing generation queue (`engineJobId` messages). The engine is restricted to `ADMIN_EMAIL`; `/engine` and `/engine/*` run through the Worker for that check. Engine work does not draw from client credit balances.

## Deploying

Apply migration **`0015_content_engine.sql`** before serving the new Worker:

```sh
npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.generated.json
```

The client studio links to the engine from its sidebar for local workspaces and the administrator.

## Code map

| Path | Purpose |
| --- | --- |
| `server/engine/bank-data.mjs` | The 100 ideas and 19 lead magnets |
| `server/engine/defaults.mjs` | Formats, slots, templates, SmileCraft brand profile |
| `server/engine/prompts.mjs` | Writing, validation, artwork and style prompts and schemas |
| `server/engine/service.mjs` | Routes (`/api/engine/*`), plans, pipeline and job consumer |
| `server/engine/local.mjs` | Local platform: Codex/agy/API adapters and file storage |
| `cloudflare/engine.mjs` | Cloud platform: API keys, R2, image binding, queue |
| `web/engine/` | The browser app (plain ES modules, styled on `/v4/styles.css`) |
| `tests/engine.test.mjs` | Pipeline, plan, editing, retry and access tests |
