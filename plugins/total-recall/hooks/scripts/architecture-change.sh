#!/usr/bin/env bash
# PostToolUse (Claude: Write|Edit|MultiEdit) / AfterTool (Gemini: write_file|replace).
# When the edited file is an ADL file and specDriven.captureChanges is on,
# ask the agent to re-index the project and record why the architecture changed.
# Any other file: a bare {"continue":true}, decided in bash without starting node
# for the default extensions, because this hook fires on every file edit.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
CONFIG="$HOME/.total-recall/config.json"
HOOK_STDIN=$(cat 2>/dev/null || true)

# Fast path: default extensions, and no custom extensions configured.
case "$HOOK_STDIN" in
  *.adl\"*) ;;
  *)
    if [ ! -f "$CONFIG" ] || ! grep -q 'Extensions' "$CONFIG" 2>/dev/null; then
      echo '{"continue":true}'
      exit 0
    fi
    ;;
esac

. "$SCRIPT_DIR/_resolve-node.sh"   # sets NODE_BIN
printf '%s' "$HOOK_STDIN" | "$NODE_BIN" "$SCRIPT_DIR/architecture-change.mjs" 2>/dev/null || echo '{"continue":true}'
