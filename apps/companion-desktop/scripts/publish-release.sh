#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?Set the existing companion release tag}"

# Verify every downloaded installer before replacing any public release asset.
(cd installers && sha256sum --check *.sha256)
if ! gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  gh release create "$RELEASE_TAG" --draft --verify-tag --title "Smilecraft Companion ${RELEASE_TAG#companion-v}" --notes-file apps/companion-desktop/RELEASE-NOTES.md
fi
gh release upload "$RELEASE_TAG" installers/* --clobber
gh release edit "$RELEASE_TAG" --draft=false --notes-file apps/companion-desktop/RELEASE-NOTES.md
