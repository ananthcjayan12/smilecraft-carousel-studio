# SmileCraft Carousel Studio

A working **local-first, dependency-free Node.js carousel builder** for SmileCraft Dental Clinic. It follows the approved workflow: idea → AI-written (or editable starter) copy → per-slide corrections and approval → visual template / photo selection → five-slide preview → individual PNGs + captions + editable JSON in a ZIP. The app's interface matches the light, teal UI concept, while the exported slides follow a dark teal, clean, uncrowded social design. Booking CTA appears **only on slide 5** in the default designs.

![Dashboard](docs/01-dashboard.png)

## Quick start

1. **Install Node.js 20 or newer** if not already installed. Extract the ZIP **with hidden files intact**; the `.git/` folder is part of the project.
2. Open a terminal in `smilecraft-carousel-studio` (the folder with `package.json`).
3. Run `npm start` (or `node server/index.mjs`). **No `npm install` is required:** the app has no third-party JavaScript dependencies.
4. Open **http://127.0.0.1:4178** in a recent Chrome, Edge, Safari or Firefox browser.
5. Select **Create Carousel** → enter a topic or choose a suggested one → choose **Generate slide copy** with Codex CLI, or **Start with editable sample** without Codex → edit and approve all five slides → choose a template → upload a separate photo for each slide if desired → Review → Export.

To use another port, set `PORT=4200` in your terminal environment. By default the server binds to `127.0.0.1`, not the public Internet.

## Codex CLI writing (uses your local Codex login)

**The browser never stores or asks for your Codex login.** Install Codex CLI on the computer where `npm start` runs and authenticate it in your normal terminal. For example, with Node/npm installed:

```sh
npm install -g @openai/codex
codex login
codex --version
npm start
```

Follow the login prompts and confirm CLI access with a simple `codex exec` command in that same terminal environment. The server runs `codex exec` in a temporary, empty working directory using `--sandbox read-only`, `--ephemeral` and `--output-last-message`, then parses/validates its JSON output. The AI drafts **copy and English visual prompts only**. It also supports **one-slide revisions from your correction text**. All AI-generated copy is **unapproved** until you explicitly approve it. If the CLI is not installed or cannot authenticate, the app shows the actual error; you can still use an editable starter and finish the project without Codex. Set `CODEX_BIN` if your executable is named or located differently.

**Important:** A ChatGPT/Codex login is not the same as an OpenAI API key. The app does not claim that using the CLI makes separately billed image generation free.

## Visuals and image rendering

The app includes four template *inspiration* thumbnails taken from the approved SmileCraft examples, and four real, programmable layouts/palettes (the first two share the editorial arrangement but differ in color). You can upload your own sample images to the template picker and choose one; these are **visual references only**, not layered, editable design files or an automatic pixel-for-pixel clone. All new text is composed onto a fresh, clean background instead of overwriting text baked into the sample image.

Each slide can use one of three imagery approaches:

- **Built-in:** a neat dental-tooth illustration drawn in HTML Canvas; works offline with no image API or payments.
- **Upload:** upload one original photo or illustration *per slide*, which is cropped into the selected 4:5 layout.
- **Optional AI photo:** after writing the `visualPrompt`, click **Generate AI photo**. This calls an image-generation endpoint **separate from Codex**, requiring `OPENAI_API_KEY` on the local server and incurring API costs. Example on macOS/Linux: `OPENAI_API_KEY='your-key' npm start`. On Windows PowerShell: `$env:OPENAI_API_KEY='your-key'; npm start`. You may choose a different supported image model with `OPENAI_IMAGE_MODEL`. Do not put your key into browser code or commit it to Git. The `.env.example` file is documentation only; no automatic `.env` loading occurs.

Images are for educational/marketing concepts; a dental professional should review anatomy and medical claims. The app's built-in photo-free renderer will not automatically create the same photorealism as externally generated images.

## Files and exports

Projects automatically save locally under `storage/projects/` (excluded from Git), plus a **Save** button. From **My Projects**, reopen, delete, or import the `project.json` exported in a previous ZIP. If you want to move the project to another computer, export/import the project JSON and the original image files as necessary. Each carousel ZIP contains:

```text
smilecraft_<topic>/
  01.png ... 05.png       # FIVE separate complete 1080 × 1350 (4:5) PNG images
  instagram_caption.txt   # editable Malayalam social copy
  youtube_title.txt
  youtube_description.txt
  project.json            # editable/re-importable backup (optional)
  README.txt
```

Social captions can be edited in the Export step. If you did not generate copy through Codex, the app composes a **draft** caption from your current slide text; review the text before posting. YouTube upload is not automated: export slides as a slideshow video in your preferred editor if you want a Short/video. The app does not upload to Instagram or YouTube.

The renderer uses the system's Malayalam font through Canvas. If Malayalam appears as squares, install a modern Malayalam-capable font on **your computer** (for example, Noto Sans Malayalam) and restart the browser. No font files are redistributed.

## Development, tests, and Git

`npm test` runs the Node.js API smoke tests. `npm run dev` runs the backend with Node's watch mode. See `docs/01-dashboard.png` through `docs/05-export.png` for walkthrough screenshots and `docs/sample-export.zip` for a small sample output. The checked-in `.git` directory contains the initial local commit; verify with `git status` and `git log --oneline -1`. To publish **your own repository** if desired, add a new remote and push manually:

```sh
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

No GitHub remote or account access is preconfigured. Uploaded assets, generated projects and credentials remain on your computer unless you choose to export/publish them. Don't bind this unauthenticated local app to a public host/network. For cloud hosting, add authentication, safe storage, rate limits, security review and a compatible Codex execution/credential model first.

## Known scope limitations

- Codex CLI supplies the **writing**, not image bytes. Photorealistic *new* photos require original uploads or the separately configured image API.
- User-uploaded template samples are selectable **style references**; custom layered template cloning is not included. Use the palette and layout presets, or upload an appropriate image individually for each slide.
- No MP4 rendering, automatic publishing, collaboration, or cloud syncing; the ZIP is designed to make manual posting simple.
- Validate any medical information with a licensed dental professional before publishing.
