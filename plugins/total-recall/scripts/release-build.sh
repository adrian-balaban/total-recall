#!/usr/bin/env bash
# Release build — the publish-time gate that produces a trustworthy dist/.
#
# `npm run release:build` runs this sequence: typecheck -> test -> build.
# It exists so a maintainer shipping a new version runs ONE command that
# refuses to emit dist/ unless typecheck and the full test suite are green.
#
# Why this exists (not a gitignore of dist/):
#   dist/ is intentionally committed to git — the plugin ships via git-subdir
#   in the marketplace and consumers receive dist/index.js as-is (install.sh
#   does NOT build on a normal install). Gitignoring dist/ would break
#   `claude plugin update` installs. So the hygiene fix is NOT "stop tracking
#   dist/", it is "never commit a dist/ that wasn't produced by this gate".
#   Run this before every commit that touches src/, then commit the rebuilt
#   dist/ together with the source change.
#
# Exit non-zero on any failure so CI / a release script can chain off it.
set -euo pipefail

echo "== release:build: typecheck =="
npm run typecheck

echo "== release:build: test =="
npm test

echo "== release:build: build =="
npm run build

echo "== release:build: OK — dist/ rebuilt and verified. Commit it with the source change. =="