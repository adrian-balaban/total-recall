#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
CACHE="$HOME/.total-recall/.index-cache.txt"

# Plugin version — single-sourced from package.json (same source the MCP server
# reports in its initialize handshake). node is this plugin's hard dependency;
# falls back to "unknown" if package.json can't be read.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/../..}"
# Pass $PLUGIN_ROOT to node via env, not by interpolating it into the JS string
# literal: a single quote or backtick in the install path would break the
# `require('...')` literal (silent 'unknown' today) and is a JS-injection vector
# if the path were ever attacker-controlled. env-pass is injection-safe.
VERSION=$(PLUGIN_ROOT="$PLUGIN_ROOT" node -e "try{process.stdout.write(String(require(process.env.PLUGIN_ROOT+'/package.json').version||'unknown'))}catch{process.stdout.write('unknown')}" 2>/dev/null || echo unknown)

# Announce the version on every session start, even before any memories exist.
if [ -f "$CACHE" ] && [ -r "$CACHE" ]; then
  # `cat` can still fail on a race (file deleted between -f and read) or a
  # permission issue; fall back to a hint instead of letting `set -e` abort the
  # hook (which would drop the whole SessionStart context injection).
  INDEX_CONTENT=$(cat "$CACHE" 2>/dev/null) || INDEX_CONTENT="(memory index unreadable — run rebuild_index)"
else
  INDEX_CONTENT="(no memories yet — store one with store_memory)"
fi

INSTRUCTIONS="## Total Recall v$VERSION — Active Memory Index

Total Recall v$VERSION active. The following memories are already in context. Use keys with get_memories_by_keys before searching.

### Retrieval Decision Tree
1. Scan this injected index first (free — already in context)
2. If key found → get_memories_by_keys(summary=true) for overview
3. If full depth needed → get_memories_by_keys(summary=false)
4. Only use search_index / recall_memory when key NOT in this index

### Capture Rules
- Call store_memory DIRECTLY from main agent (never delegate to subagent)
- Check for duplicates before storing
- Always include executive summary with WHY, not just WHAT
- Preferred categories: architecture, decisions, troubleshooting, meetings, knowledge, journal

### Memory Index
$INDEX_CONTENT"

# hookSpecificOutput REQUIRES hookEventName:"SessionStart" or additionalContext is
# silently dropped (verified against the Claude Code hooks reference). Without it,
# the injected memory index — the plugin's core feature — never reached Claude.
# JSON-encode via node (node is this plugin's hard dependency; python3 is not).
ADDCONTEXT=$(printf '%s' "$INSTRUCTIONS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))') || ADDCONTEXT='""'
echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$ADDCONTEXT}}"
