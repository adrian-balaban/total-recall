#!/usr/bin/env bash
set -euo pipefail

PERSONAL_VAULT="$HOME/.total-recall/personal-vault"
OQ_FILE=$(find "$PERSONAL_VAULT" \( -name "*open*question*" -o -name "*ambient*curiosity*" \) 2>/dev/null | head -1)

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
ADDCONTEXT=$(printf '## Ambient Curiosity — Open Technical Questions\n\n%s' "$CONTENT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))' 2>/dev/null) || ADDCONTEXT='""'
# Guard against an empty ADDCONTEXT (node missing/failed): a bare
# "additionalContext:" in the JSON below would make the hook output unparseable
# and silently drop the whole SessionStart context. Match load-memory-index.sh.
[ -n "$ADDCONTEXT" ] || ADDCONTEXT='""'
echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$ADDCONTEXT}}"
