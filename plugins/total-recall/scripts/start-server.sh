#!/usr/bin/env bash
# start-server.sh — launches the MCP server with a node resolved the way the hook
# scripts do it (nvm/fnm/Volta-safe), for hosts that start MCP servers with a
# PATH that has no `node`. stdout is the MCP transport: print nothing here.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
. "$SCRIPT_DIR/../hooks/scripts/_resolve-node.sh"
if [ -z "${NODE_BIN:-}" ]; then
  echo "total-recall: node not found (need v18+)" >&2
  exit 1
fi
exec "$NODE_BIN" "$SCRIPT_DIR/../dist/index.js" "$@"
