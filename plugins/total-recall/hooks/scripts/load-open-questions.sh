#!/usr/bin/env bash
# SessionStart hook: inject "ambient curiosity" (open questions) into model context at session start
# Searches personal vault for a file matching "*open*question*" or "*ambient*curiosity*"
# and injects it as persistent memory of technical questions / unresolved risks / investigation backlog
set -euo pipefail

. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)/_resolve-node.sh"   # sets NODE_BIN (nvm/stripped-PATH safe)

# ─── Configuration: locate the personal vault ───────────────────────────────
PERSONAL_VAULT="$HOME/.total-recall/personal-vault"
CONFIG_FILE="$HOME/.total-recall/config.json"

# If the user has configured a custom personal-vault path in config.json, resolve and use it
if [ -f "$CONFIG_FILE" ]; then
  PERSONAL_VAULT=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); let p=c.personalVault; if(p){ p=p.replace(/^~(?=\/|$)/, require('os').homedir()); p=require('path').resolve(p); } console.log(p || '$PERSONAL_VAULT'); } catch { console.log('$PERSONAL_VAULT'); }")
fi

# ─── Find the open-questions file ───────────────────────────────────────────
# Search for files matching "*open*question*" or "*ambient*curiosity*" (case-insensitive)
# Take the first match; skip on error (vault dir missing on fresh install)
#
# Note: `|| true` is required under `set -euo pipefail` because:
#   (1) If vault dir is absent (fresh install before any store_memory), find exits non-zero
#       → set -e aborts the hook → Claude Code treats it as failed
#   (2) If multiple matches exist, `head -1` closes the pipe early
#       → find gets SIGPIPE (exit 141) → pipeline fails → set -e aborts
# Collapse both to exit 0; the -z and -f guards below handle the no-match case explicitly
OQ_FILE=$(find "$PERSONAL_VAULT" -type f \( -iname '*open*question*' -o -iname '*ambient*curiosity*' \) 2>/dev/null | head -1 || true)

# If no file was found, or it doesn't exist, skip this hook (no context injection)
if [ -z "$OQ_FILE" ] || [ ! -f "$OQ_FILE" ]; then
  echo '{"continue":true}'
  exit 0
fi

# ─── Size check: skip if file is too large ──────────────────────────────────
# Memories > 3 KB are usually archives, not live questions; skip them to keep context lean
SIZE=$(wc -c < "$OQ_FILE")
if [ "$SIZE" -gt 3072 ]; then
  echo '{"continue":true}'
  exit 0
fi

# ─── Read, format, and inject into context ──────────────────────────────────
CONTENT=$(cat "$OQ_FILE")

# CRITICAL: hookSpecificOutput MUST include hookEventName:"SessionStart"
# without it, Claude Code silently drops additionalContext (verified against hooks reference)
# JSON-encode via node (mandatory hard dependency; python3 not guaranteed available)
ADDCONTEXT=$(printf '## Ambient Curiosity — Open Technical Questions\n\n%s' "$CONTENT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))' 2>/dev/null) || ADDCONTEXT='""'

# Guard: if node fails or ADDCONTEXT is empty, output valid JSON with empty context
# A bare "additionalContext:" (no value) breaks the JSON and silently drops SessionStart injection
# Match the same guard in load-memory-index.sh for consistency
[ -n "$ADDCONTEXT" ] || ADDCONTEXT='""'

# ─── Emit the hook result ───────────────────────────────────────────────────
# Format: {continue:true, hookSpecificOutput: {hookEventName, additionalContext}}
# This tells Claude Code to proceed and inject the questions into the model context
echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$ADDCONTEXT}}"
