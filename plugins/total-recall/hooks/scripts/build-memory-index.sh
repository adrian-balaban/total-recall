#!/usr/bin/env bash
# Rebuilds ~/.total-recall/.index-cache.txt, the index injected at SessionStart.
#
# The walk rules and the frontmatter parser live in TypeScript (src/vault-walk.ts,
# src/index-cache.ts) and are bundled to dist/build-index-cache.mjs, so the server and
# this hook share one parser instead of a bash copy that had to be kept in step by hand.
# This script only finds node and runs the bundle.
#
# On failure the bundle exits non-zero, leaves the previous cache in place and appends a
# line to ~/.total-recall/.index-cache.log; this script then exits non-zero too.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
# shellcheck source=_resolve-node.sh
. "$SCRIPT_DIR/_resolve-node.sh"

NODE_BIN="${NODE_BIN:-node}"
BUNDLE="$SCRIPT_DIR/../../dist/build-index-cache.mjs"

if [ ! -f "$BUNDLE" ]; then
  echo "build-memory-index: $BUNDLE is missing — run 'npm run build' in the plugin root" >&2
  exit 1
fi

exec "$NODE_BIN" "$BUNDLE"
