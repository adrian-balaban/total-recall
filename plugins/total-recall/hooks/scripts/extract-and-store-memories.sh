#!/usr/bin/env bash
# Runs before context compaction. Extracts 0-3 reusable learnings from the session
# transcript and writes them directly to the personal vault.
#
# Storage is a direct file write (store-learning.cjs), NOT a nested `claude -p --mcp`
# call — that flag does not exist, so the previous version silently stored nothing.
# Files land on disk and are picked up by the next boot's reconcile_index / by an
# explicit rebuild_index.
set -euo pipefail

# Claude Code passes hook input as JSON on stdin; transcript_path is a common
# field there (NOT a CLAUDE_TRANSCRIPT_PATH env var — that env var is never set,
# so the previous version always exited here and PreCompact was a permanent
# no-op that stored nothing). Read stdin once, parse transcript_path via node.
HOOK_INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$HOOK_INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).transcript_path||"")}catch{}})' 2>/dev/null || echo "")

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Guard: if the `claude` CLI is not on PATH (e.g. hook fired in an environment
# without the binary, or a broken install), `claude -p` below would fail under
# `set -e` and — even with the trailing `|| true` — emit a confusing error to
# the user. Skip cleanly instead; the next compaction will retry.
command -v claude >/dev/null 2>&1 || { echo "extract-and-store-memories: claude CLI not found — skipping" >&2; echo '{"continue":true}'; exit 0; }

EXTRACT_PROMPT='You are reviewing a Claude Code session transcript. Extract 0-3 distinct, reusable learnings worth storing as persistent memories.

For each learning output a JSON object on a single line:
{"title": "...", "content": "## Executive Summary\n\n...", "tags": [...], "category": "...", "importanceScore": 0.0-1.0}

Only output JSON lines. No prose. If nothing is worth storing, output nothing.

Rules:
- Only store things with long-term reuse value
- Include WHY, not just WHAT
- Do not store ephemeral task details'

# Extract via `claude -p` (valid), then write each JSON line straight to the vault.
# store-learning.cjs validates JSON, slugifies, and skips existing memories.
claude -p "$EXTRACT_PROMPT" < "$TRANSCRIPT" 2>/dev/null \
  | node "$SCRIPT_DIR/store-learning.cjs" 2>/dev/null || true

echo '{"continue":true}'