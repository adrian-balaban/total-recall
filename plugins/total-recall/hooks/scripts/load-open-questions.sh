#!/usr/bin/env bash
set -euo pipefail

. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)/_resolve-node.sh"   # sets NODE_BIN (nvm/stripped-PATH safe)

PERSONAL_VAULT="$HOME/.total-recall/personal-vault"
CONFIG_FILE="$HOME/.total-recall/config.json"

if [ -f "$CONFIG_FILE" ]; then
  PERSONAL_VAULT=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); let p=c.personalVault; if(p){ p=p.replace(/^~/, require('os').homedir()); p=require('path').resolve(p); } console.log(p || '$PERSONAL_VAULT'); } catch { console.log('$PERSONAL_VAULT'); }")
fi
# `|| true` is load-bearing under `set -euo pipefail`: (1) if the personal vault
# dir is absent (fresh install before any store_memory), find exits non-zero and
# the pipeline's status is non-zero → set -e aborts the SessionStart hook before
# the `continue:true` fallback below ever runs → Claude Code treats the hook as
# failed. (2) if MORE than one file matches, `head -1` closes the pipe after the
# first line and find gets SIGPIPE on its next write → find exits 141 → with
# pipefail the pipeline returns 141 → set -e aborts for the same reason. `|| true`
# collapses both to status 0; the `-z "$OQ_FILE"` / `-f` guards below handle the
# no-match case explicitly.
OQ_FILE=$(find "$PERSONAL_VAULT" \( -name "*open*question*" -o -name "*ambient*curiosity*" \) 2>/dev/null | head -1 || true)

if [ -z "$OQ_FILE" ] || [ ! -f "$OQ_FILE" ]; then
  echo '{"continue":true}'
  exit 0
fi

SIZE=$(wc -c < "$OQ_FILE")
# Skip if > 3KB
if [ "$SIZE" -gt 3072 ]; then
  echo '{"continue":true}'
  exit 0
fi

CONTENT=$(cat "$OQ_FILE")
# hookSpecificOutput REQUIRES hookEventName:"SessionStart" or additionalContext is
# silently dropped (verified against the Claude Code hooks reference). JSON-encode
# via node (node is this plugin's hard dependency; python3 is not guaranteed).
ADDCONTEXT=$(printf '## Ambient Curiosity — Open Technical Questions\n\n%s' "$CONTENT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))' 2>/dev/null) || ADDCONTEXT='""'
# Guard against an empty ADDCONTEXT (node missing/failed): a bare
# "additionalContext:" in the JSON below would make the hook output unparseable
# and silently drop the whole SessionStart context. Match load-memory-index.sh.
[ -n "$ADDCONTEXT" ] || ADDCONTEXT='""'
echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$ADDCONTEXT}}"
