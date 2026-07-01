#!/usr/bin/env bash
# session-end.sh — SessionEnd hook for total-recall
#
# Runs when Claude Code ends a session. Three responsibilities:
#
#   1. Log a session-end marker to ~/.total-recall/.session-end.log so the user
#      can answer "did the session even reach the SessionEnd hook?" without
#      reasoning about MCP stdio timing. The MCP server's stdin-end handler
#      (src/index.ts) is the primary flush trigger; this log is observability
#      for that path, not the flush itself.
#
#   2. Belt-and-braces SIGTERM to the running MCP child process. The stdio-end
#      handler is the main path; SIGTERM here is the backup if the stdio
#      streams are held open for any reason (e.g. a stuck transport). The MCP
#      child has SIGTERM/SIGINT wired to shutdown() (src/index.ts:30-31), so
#      flushPending → flushEmbeddings → process.exit(0) run either way.
#
#   3. Emit a SessionEnd JSON envelope on stdout so Claude Code records the
#      hook ran. Like SessionStart, the additionalContext must carry
#      hookEventName:"SessionEnd" — Claude Code DROPS envelopes missing it
#      (silent drop, no UI surface). See hook-scripts.test.ts #24.
#
# Idempotent. No required tools beyond bash; uses ps + grep + kill which are
# available on every Unix. Every action is best-effort: a miss (no MCP child
# running, permission denied on .total-recall/) is silent — the SessionEnd
# hook is observability, not correctness, and a non-zero exit here would
# surface as a "hook failed" warning in Claude Code on every session end,
# which is more noise than value.

set -euo pipefail

TOTAL_RECALL_DIR="${TOTAL_RECALL_DIR:-$HOME/.total-recall}"
LOG="$TOTAL_RECALL_DIR/.session-end.log"

# Append-only, no rotation. One line per session end. The mtime is also a
# "last clean session" timestamp you can correlate with index.json's mtime
# to detect missed flushes.
mkdir -p "$TOTAL_RECALL_DIR" 2>/dev/null || true
printf '%s pid=%s ppid=%s claude_session_id=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "${$:-unknown}" \
  "${PPID:-unknown}" \
  "${CLAUDE_SESSION_ID:-unknown}" \
  >> "$LOG" 2>/dev/null || true

# Find the running MCP child of THIS Claude Code process (PPID = our parent).
# Match the node entry by argv — the dist path is the production entry. The
# `head -1` is defensive in case multiple processes match (shouldn't happen
# in normal use, but a SIGTERM to the wrong pid is worse than no SIGTERM).
MCP_PID=""
if [ -n "${PPID:-}" ] && [ "$PPID" != "unknown" ]; then
  MCP_PID="$(ps -o pid= --ppid "$PPID" 2>/dev/null | xargs -I{} sh -c 'ps -o pid=,args= -p "{}" 2>/dev/null' | grep -E "node.*dist/index\.js|tsx.*src/index\.ts" | awk '{print $1}' | head -1 || true)"
fi
if [ -n "$MCP_PID" ]; then
  # -TERM (not -KILL): gives the MCP child a chance to run shutdown() and
  # flush. -KILL would skip the flush and reintroduce the original bug.
  kill -TERM "$MCP_PID" 2>/dev/null || true
fi

# Emit the SessionEnd envelope. additionalContext is what Claude Code
# surfaces to the user; the hookEventName is mandatory (see #24) — without
# it Claude Code drops the entire additionalContext silently.
EXIT_STATUS="unknown"
if [ -n "$MCP_PID" ]; then
  EXIT_STATUS="signaled"
fi
printf '{"hookSpecificOutput":{"hookEventName":"SessionEnd","additionalContext":"total-recall session end: mcp_child=%s, log=%s"}}\n' \
  "${MCP_PID:-none}" "$LOG"
