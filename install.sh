#!/usr/bin/env bash
# Build total-recall from this clone and install it (local release). See plugins/total-recall/INSTALL.md.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
command -v node >/dev/null 2>&1 || { echo "install.sh: Node.js 18+ is required (https://nodejs.org)." >&2; exit 1; }
exec node "$ROOT/bin/cli.mjs" --local "$ROOT" "$@"
