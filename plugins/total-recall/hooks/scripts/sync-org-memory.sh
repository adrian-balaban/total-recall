#!/usr/bin/env bash
set -euo pipefail

. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)/_resolve-node.sh"   # sets NODE_BIN (nvm/stripped-PATH safe)

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
# Emit "<key>\x1f<delete-flag>\x1f<force-flag>" (\x1f = ASCII unit separator) so
# bash can split it without a second parse call — see the comment at the `read`
# below for why \x1f (not a tab) is the delimiter.
# Parse via node (node is this plugin's hard dependency; python3 is not guaranteed,
# so a python3 parser would silently no-op org sync on python3-less systems — the
# same silent-no-op class the other hooks were fixed to avoid).
PARSED=$(printf '%s' "$HOOK_INPUT" | "$NODE_BIN" -e '
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
  const force = d.tool_input && d.tool_input.force === true ? 1 : 0;
  process.stdout.write(key + "\x1f" + flag + "\x1f" + force);
});
' 2>/dev/null || true)

# \x1f (ASCII unit separator) is non-whitespace. bash `read` strips a LEADING
# IFS-whitespace delimiter, so a TAB here would turn an empty key into the delete-flag
# value and the -z guard would misfire (running the sync with "0"/"1" as the key).
# With \x1f an empty key stays empty. Keys are slugified paths and never contain \x1f,
# so the delimiter is collision-free. Three fields: KEY, DELETE_FLAG, FORCE_FLAG.
IFS=$'\x1f' read -r KEY DELETE_FLAG FORCE_FLAG <<< "$PARSED"

if [ -z "$KEY" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
QUEUE_DIR="$HOME/.total-recall/org/.sync-queue"
LOCK="$HOME/.total-recall/org/.sync.lock"
SYNC_LOG="$HOME/.total-recall/org/.sync.log"
mkdir -p "$(dirname "$QUEUE_DIR")"
mkdir -p "$QUEUE_DIR"

log_warn() {
  echo "warning: $1" >>"$SYNC_LOG"
}

# Run the mjs git sync for a single queued org key.
run_queued_sync() {
  local q_key="$1" q_delete="$2" q_force="$3"
  if [ "$q_delete" = "1" ]; then
    if [ "$q_force" = "1" ]; then
      "$NODE_BIN" "$PLUGIN_ROOT/scripts/sync-org-memory.mjs" "$q_key" --delete --force
    else
      "$NODE_BIN" "$PLUGIN_ROOT/scripts/sync-org-memory.mjs" "$q_key" --delete
    fi
  else
    "$NODE_BIN" "$PLUGIN_ROOT/scripts/sync-org-memory.mjs" "$q_key"
  fi
}

# Process every job file currently in the queue directory. Each job file is an
# atomic, complete record created by the hook via mktemp+rename, so a concurrent
# hook can add new files while we drain without corrupting the queue.
drain_queue() {
  local job_files=()
  while IFS= read -r -d '' f; do
    job_files+=("$f")
  done < <(find "$QUEUE_DIR" -maxdepth 1 -type f -print0 2>/dev/null)

  for job in "${job_files[@]}"; do
    [ -f "$job" ] || continue
    local q_key="" q_delete="0" q_force="0"
    IFS=$'\t' read -r q_key q_delete q_force < "$job" || true
    rm -f "$job"
    [ -z "$q_key" ] && continue
    [[ "$q_key" != org/* ]] && continue
    run_queued_sync "$q_key" "${q_delete:-0}" "${q_force:-0}" || {
      echo "sync failed for $q_key" >>"$SYNC_LOG"
    }
  done
}

# Background worker: holds the exclusive lock, drains the queue repeatedly, and
# rebuilds the injected memory index once after the queue is quiet. Because the
# lock is advisory, the queue is implemented as a directory of atomic job files
# so appends never race with the drain.
start_worker() {
  (
    while true; do
      drain_queue
      # After draining, see if more jobs arrived during the last pass.
      any_jobs=$(find "$QUEUE_DIR" -maxdepth 1 -type f -print0 2>/dev/null | head -c 1)
      if [ -z "$any_jobs" ]; then
        # Queue is quiet — rebuild the injected index, then check one last time
        # in case a hook appended a job just before we released the lock.
        bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh"
        any_jobs=$(find "$QUEUE_DIR" -maxdepth 1 -type f -print0 2>/dev/null | head -c 1)
        [ -z "$any_jobs" ] && break
      fi
    done
    # Release the inherited lock before exiting.
    flock -u 9
  ) >>"$SYNC_LOG" 2>&1 &
}

case "$KEY" in
  org/*)
    # Coalesce org syncs: append an atomic job record, then start a background
    # worker only if none is already running (flock -n). The worker drains the
    # entire queue, so a burst of org writes results in one git sync process per
    # session instead of one per key.
    JOB_TMP=$(mktemp)
    printf '%s\t%s\t%s\n' "$KEY" "$DELETE_FLAG" "$FORCE_FLAG" > "$JOB_TMP"
    mv "$JOB_TMP" "$QUEUE_DIR/"

    if command -v flock >/dev/null 2>&1; then
      exec 9>"$LOCK"
      if flock -n -x 9; then
        # Pass the open fd 9 (and the lock) to the background worker, then close
        # our copy. The worker holds the lock until it drains the queue and exits.
        start_worker
        exec 9>&-
      fi
    else
      log_warn "'flock' not found; org sync running without coalescing lock"
      run_queued_sync "$KEY" "$DELETE_FLAG" "$FORCE_FLAG" || true
      bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" >>"$SYNC_LOG" 2>&1 &
    fi
    ;;
  *)
    # Personal memory store/update/delete: no org-vault git sync, but rebuild
    # the local injected index so the new/deleted memory reflects immediately.
    bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" >>"$SYNC_LOG" 2>&1 &
    ;;
esac

echo '{"continue":true}'
