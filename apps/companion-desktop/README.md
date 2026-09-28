# Smilecraft Companion

A Tauri desktop app that runs signed-in Codex or Antigravity CLIs on the user's computer for Smilecraft carousel writing. Rust handles pairing, system credential storage, provider discovery, bounded subprocesses, polling, heartbeat, cancellation, and delivery. The bundled UI has no Node runtime or remote scripts.

## Use

1. Install and sign in to a current Codex or Antigravity CLI.
2. In Smilecraft Settings, an administrator enables Companion for the account.
3. In Settings → AI on your computer, create a one-time pairing code (valid for five minutes).
4. Open Smilecraft Companion, enter the Smilecraft website origin, a computer name, and the code. Pair and start the app.
5. In a carousel, choose Codex or Antigravity as the writing provider. Keep the companion running while creating a five-slide draft or revising a slide.

Local writing costs zero Smilecraft credits and uses the user's CLI account and limits. Image generation remains with the cloud API providers. The companion credential is stored in macOS Keychain or Windows Credential Manager. Revoke a device in website Settings to stop it; Forget pairing only clears the local credential. Closing the window keeps the app in the menu bar or system tray.

The app searches PATH and common user install locations. An absolute path to a native executable may be set in the UI. Windows `.cmd` wrappers are not launched. Network requests require HTTPS, except loopback HTTP for development. Redirects and oversized responses are rejected.

## Build

Install [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and Node.js 22. From the repository root:

```sh
npm ci
npm run companion:desktop
cargo test --locked --manifest-path apps/companion-desktop/src-tauri/Cargo.toml
npm run companion:build -- --bundles dmg  # macOS
npm run companion:build -- --bundles nsis # Windows
```

The Worker migration `cloudflare/migrations/0006_companion.sql` and Worker code must be deployed before pairing. The release workflow builds Apple Silicon, Intel Mac, and Windows x64 installers. Manual runs and pull requests upload Actions artifacts. A `companion-v0.1.0` tag publishes a GitHub Release after all builds pass. Update the app versions and lockfiles before a later tag. No automatic updater is configured. Signing credentials are optional; unsigned Windows builds and ad-hoc signed macOS builds may show OS warnings.
