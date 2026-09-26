# Carousel Studio v.a.1 — lightweight desktop architecture

This branch converts the local-first v2 product into a single-install desktop application without Electron, Chromium, a bundled Node runtime, Python, or a separately visible local agent.

## Runtime

- **Tauri 2** provides the native window and OS webview.
- A small **Rust loopback server** binds only to `127.0.0.1` on an ephemeral port.
- The existing `web/` UI is embedded into the binary and served by that loopback server, so existing relative `/api/*` calls continue to work.
- **SQLite** and assets live under the OS application-data directory.
- API credentials are stored through the OS credential vault via the `keyring` crate (macOS Keychain / Windows Credential Manager).
- Codex and Antigravity remain optional advanced integrations. The app detects the customer's own installed CLI and never bundles those CLIs.
- OpenAI, Gemini and Anthropic requests use the customer's own API keys directly from the local application.

## Why this stays light

The application does **not** ship Chromium or Node. The release profile enables LTO, symbol stripping, one codegen unit and size optimization. The largest bundled bytes are currently the existing reference-template images under `web/assets/design-systems`; those can later be moved to an optional downloadable template pack to reduce the installer further.

## Local security boundary

The HTTP server:
- binds only to `127.0.0.1`;
- chooses an ephemeral port;
- rejects oversized request bodies;
- does not expose API keys through its status endpoint;
- keeps generated files and database records local.

## Build outputs

`.github/workflows/desktop-build.yml` builds:
- macOS: `.dmg`
- Windows: NSIS `.exe`

The CI artifacts are intentionally unsigned developer builds. For public distribution, configure Apple Developer ID/notarization and Windows code-signing secrets, then use the release workflow.

## OTA updates

OTA updates are intentionally **not included in v.a.1**. The updater plugin is omitted entirely so an unset updater configuration cannot affect application startup. When a production HTTPS update endpoint and signing key are ready, add the updater plugin back together with a valid signed configuration and release artifacts.

## Development

The old Node server is retained for regression comparison and tests while v.a.1 is validated. The packaged desktop application does not launch or depend on Node.

## macOS 26 compatibility note

Tauri 2.11.x currently resolves to tao 0.35.3, which has an upstream Apple-Silicon startup-abort report on macOS 26 Tahoe. v.a.1 therefore pins Tauri 2.9.5 / the pre-tao-0.35 runtime until the upstream lifecycle issue is fixed. CI explicitly runs the macOS build on a macOS 26 ARM runner and launches the built app for a startup smoke test before publishing the DMG artifact.
