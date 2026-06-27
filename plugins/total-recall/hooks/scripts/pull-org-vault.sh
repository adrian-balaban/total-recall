#!/usr/bin/env bash
set -euo pipefail

ORG_VAULT="$HOME/.total-recall/org"
BRANCH="org-vault"
CONFIG_FILE="$HOME/.total-recall/config.json"
# Read orgRepo from config.json via node (node is a hard dependency of this
# plugin; python3 is not guaranteed). Falls back to '' on any error.
ORG_REPO=$(node -e "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')).orgRepo||''))}catch{}" 2>/dev/null || echo "")
if [ -z "$ORG_REPO" ]; then
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault skipped: orgRepo not set in ~/.total-recall/config.json"}}'
  exit 0
fi

# Reject a non-URL orgRepo early. A typo or a local path in config.json would
# hand `gh repo clone` / `git clone` an unusable argument (confusing error) or,
# for a path that happens to exist locally, attempt a clone of an unintended
# source. Only https:// and git@ SSH URLs are valid remotes.
case "$ORG_REPO" in
  https://*|git@*) ;;
  *) echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault skipped: orgRepo in config.json is not an https:// or git@ SSH URL."}}'; exit 0 ;;
esac

# Use gh for authenticated git operations
export GIT_ASKPASS=""
export GIT_TERMINAL_PROMPT=0
GH_TOKEN=$(gh auth token 2>/dev/null || echo "")
[ -n "$GH_TOKEN" ] && export GITHUB_TOKEN="$GH_TOKEN"

mkdir -p "$ORG_VAULT"

if [ ! -d "$ORG_VAULT/.git" ]; then
  if ! gh repo clone "$ORG_REPO" "$ORG_VAULT" -- --branch "$BRANCH" --depth 1 2>/dev/null; then
    if ! git clone --branch "$BRANCH" --depth 1 "$ORG_REPO" "$ORG_VAULT" 2>/dev/null; then
      echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Failed to clone org vault."}}'
      exit 0
    fi
  fi
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault cloned."}}'
  exit 0
fi

cd "$ORG_VAULT"
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
# Pull with a real success/failure branch. The old form `git pull ... || true`
# swallowed pull failures and then reported "up-to-date" whenever BEFORE==AFTER —
# so a network/auth error looked identical to "nothing new", silently leaving the
# vault stale. Now a failed pull is reported as such (and the local copy is used).
if git pull --ff-only origin "$BRANCH" 2>/dev/null; then
  AFTER=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [ "$BEFORE" = "$AFTER" ]; then
    echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault up-to-date."}}'
  else
    echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"Org vault updated: $BEFORE -> $AFTER\"}}"
  fi
else
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault pull failed (network/auth) — using local copy."}}'
fi
