# Project studio regression fixes

Compared against local `v1` (45f9bdd). Client ownership, saved context, template libraries and explicit artwork reviews remain in the multi-client workflow.

Restored v1 image and text provider adapters, including image retries, response validation, diagnostic logs, CLI image instructions, output checks, AGY semantic retry and schema descriptions. Dental bilingual drafting and image layout prompts use the v1 wording with the saved client identity; other business types retain their own context.

Fixed project controls:

- Writing provider/model selectors in Topic and Content, image model dropdowns, provider readiness, and AGY model refresh.
- Provider changes reset the model. Older saved projects carrying an image API model into Codex are repaired in the UI and server adapter.
- Batch progress waits for all slide requests, preserves successes, reports individual failures and uses new request IDs for explicit retries.
- Serialized saves, save-before-navigation/generation, and save-before-approval prevent stale or unsaved edits being used.
- Slide selection in Design, custom image references, dental topic samples, reference previews, discard/regenerate and single PNG downloads.
- New dental projects select a master reference. Template changes invalidate artwork server-side. Portable export includes built-in board bytes.
- Reference crops are enlarged as in v1. Full boards display without thumbnail clipping.

Verification: full Node test suite; regression test executes a simulated Codex binary and checks model repair, reference order and CLI instructions. Browser checks use temporary storage, verify writing/image provider switching and model dropdowns, and confirm saved selections through the API. Custom-reference upload checked through the scoped API. No paid/live AI generation was used, so actual provider output quality and account quota are not verified.

Restart the local server and reload the browser to use the updated adapters and controls. Existing projects are repaired when opened/saved; retry their missing slides from Design.

## Business-aware prompts

Scoped projects now build writing, rewrite and image prompts from the saved business context and the selected template identity/version. Dental, tour, salon, construction and general business each have distinct factual and visual guidance. Client language and CTA override legacy defaults. The legacy flat API retains its original dental prompt for compatibility.

The Topic step also exposes the reference selector. Writing providers receive reference metadata (not image pixels); image providers receive the actual selected image and, for boards, the complete board plus the matching enlarged crop. Template imagery controls presentation but cannot supply business facts or override approved copy. The selected reference identity and checksum are recorded in job inputs.
