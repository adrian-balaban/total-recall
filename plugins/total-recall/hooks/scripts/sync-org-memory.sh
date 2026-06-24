#!/usr/bin/env bash
set -euo pipefail

# Claude Code delivers the PostToolUse payload as JSON on STDIN, not as argv.
# The old code read "$1" (always empty here) and then a nonexistent "tool_result"
# field, so KEY was always empty, the early-return fired, and org sync was a
# silent no-op for EVERY store/update/delete. Read stdin once and parse it for
# real.
HOOK_INPUT=$(cat)

# tool_name is "mcp__<server>__<tool>" for MCP tools; the matcher is on the
# "store_memory|update_memory|delete_memory" suffix. tool_response for an MCP
# tool is the MCP envelope {content:[{type:"text", text:"<json>"}]} whose text
# is the tool's own JSON return (e.g. {"key":"org/architecture/foo",...}); some
# transports send the object unwrapped. Handle both, then fall back to
# tool_input.key (present on the request side) if the response carried no key.
# Emit "<key>\x1f<delete-flag>" (\x1f = ASCII unit separator) so bash can split it
# without a second parse call — see the comment at the `read` below for why \x1f
# (not a tab) is the delimiter.
# Parse via node (node is this plugin's hard dependency; python3 is not guaranteed,
# so a python3 parser would silently no-op org sync on python3-less systems — the
# same silent-no-op class the other hooks were fixed to avoid).
PARSED=$(printf '%s' "$HOOK_INPUT" | node -e '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  let d = {};
  try { d = JSON.parse(s); } catch {}
  const tn = d.tool_name || "";
  let key = "";
  const resp = d.tool_response;
  if (resp && typeof resp === "object" && !Array.isArray(resp)) {
    const content = resp.content;
    if (Array.isArray(content)) {
      for (const it of content) {
        if (it && it.type === "text") {
          let p = null;
          try { p = JSON.parse(it.text || ""); } catch {}
          if (p && p.key) { key = p.key; break; }
        }
      }
    }
    if (!key && resp.key) key = resp.key;
  }
  if (!key && d.tool_input && d.tool_input.key) key = d.tool_input.key;
  const flag = tn.endsWith("delete_memory") ? 1 : 0;
  process.stdout.write(key + "\x1f" + flag);
});
' 2>/dev/null || true)

# \x1f (ASCII unit separator) is non-whitespace. bash `read` strips a LEADING
# IFS-whitespace delimiter, so a TAB here would turn an empty key into the delete-flag
# value and the -z guard would misfire (running the sync with "0"/"1" as the key).
# With \x1f an empty key stays empty. Keys are slugified paths and never contain \x1f,
# so the delimiter is collision-free.
IFS=$'\x1f' read -r KEY DELETE_FLAG <<< "$PARSED"

if [ -z "$KEY" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK="$HOME/.total-recall/org/.sync.lock"
SYNC_LOG="$HOME/.total-recall/org/.sync.log"
mkdir -p "$(dirname "$LOCK")"

# Run the git sync under an exclusive flock so concurrent PostToolUse invocations
# serialize instead of racing on the same org-vault repo (checkout/pull/push). The
# flock blocks, but the whole subshell is backgrounded so the hook never blocks the
# session; queued syncs simply run one after another and no key's sync is dropped.
# build-memory-index only writes the local cache file, so it stays outside the lock.
#
# The backgrounded subshell inherits fd 1 (this hook's stdout pipe to Claude Code).
# Without a redirect, the node child's console.log lines append to the hook's
# `{"continue":true}` JSON AFTER it is emitted — the pipe stays open until the
# backgrounded child exits, so Claude Code reads the extra lines and may fail to
# parse the hook output. Redirect the backgrounded children's stdout+stderr to a
# log file so the hook emits exactly one clean JSON line and the sync output is
# still discoverable at ~/.total-recall/org/.sync.log.
#
# Only org-tagged memories live in the shared git vault (their keys are prefixed
# `org/`). A personal memory store/update/delete must NOT spawn the cjs git
# sync — the cjs would treat a non-org key as missing from the org vault and
# (attempt to) push a deletion / no-op, wasting a lock+spawn per personal write
# and, for --delete, removing an unrelated entry if a path collision occurred.
# Short-circuit personal keys: skip the cjs entirely but still rebuild the cache
# below (personal writes must reflect in the injected index).
case "$KEY" in
  org/*)
    if [ "$DELETE_FLAG" = "1" ]; then
      (
        flock -x 9
        node "$PLUGIN_ROOT/scripts/sync-org-memory.cjs" "$KEY" --delete
      ) 9>"$LOCK" >>"$SYNC_LOG" 2>&1 &
    else
      (
        flock -x 9
        node "$PLUGIN_ROOT/scripts/sync-org-memory.cjs" "$KEY"
      ) 9>"$LOCK" >>"$SYNC_LOG" 2>&1 &
    fi
    ;;
  *) ;;  # personal key: no org-vault git sync needed
esac

bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" >>"$SYNC_LOG" 2>&1 &

echo '{"continue":true}'