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
#   3. Emit a valid SessionEnd stdout envelope. UNLIKE SessionStart, the
#      SessionEnd event does NOT accept `hookSpecificOutput.additionalContext`
#      (there is no ongoing conversation to inject context into at teardown) —
#      emitting that shape makes Claude Code REJECT the output with
#      "Hook JSON output validation failed — (root): Invalid input", which
#      surfaced as a "hook failed" warning on every session end (observed 92×
#      in ~/.total-recall/.extract.log) and could abort the hook before its
#      SIGTERM-flush side effect. The universally-valid envelope for any hook
#      event is `{"continue":true}`; the hook's real work is the side effects
#      above (log + SIGTERM), not stdout. See hook-scripts.test.ts.
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
  # Match a child of our parent whose command line contains the MCP entry point.
  # `pgrep -P` lists children of PPID; the pattern is anchored to the node/tsx
  # binary and the canonical dist/index.js path to avoid false positives.
  MCP_PID="$(pgrep -P "$PPID" -fa "(node|tsx).*(dist/index\.js|src/index\.ts)" 2>/dev/null | awk '{print $1}' | head -1 || true)"
fi
if [ -n "$MCP_PID" ]; then
  # -TERM (not -KILL): gives the MCP child a chance to run shutdown() and
  # flush. -KILL would skip the flush and reintroduce the original bug.
  kill -TERM "$MCP_PID" 2>/dev/null || true
fi

# Emit a valid SessionEnd envelope. SessionEnd does NOT accept
# additionalContext (see the header note) — the only universally-accepted
# shape is {"continue":true}. The mcp_child / log detail lives in
# .session-end.log (written above), not stdout, so no observability is lost.
printf '{"continue":true}\n'
