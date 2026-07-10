#!/usr/bin/env bash
set -euo pipefail

. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)/_resolve-node.sh"   # sets NODE_BIN (nvm/stripped-PATH safe)

ORG_VAULT="$HOME/.total-recall/org"
BRANCH="org-vault"
CONFIG_FILE="$HOME/.total-recall/config.json"

if [ -f "$CONFIG_FILE" ]; then
  ORG_VAULT=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); let p=c.orgVault; if(p){ p=p.replace(/^~/, require('os').homedir()); p=require('path').dirname(require('path').resolve(p)); } console.log(p || '$ORG_VAULT'); } catch { console.log('$ORG_VAULT'); }")
fi
# Read orgRepo from config.json via node (node is a hard dependency of this
# plugin; python3 is not guaranteed). Falls back to '' on any error.
# Pass $CONFIG_FILE to node via env, not by interpolating it into the JS string
# literal (mirrors load-memory-index.sh): a quote/backtick in $HOME would break
# the readFileSync literal and silently skip org sync. env-pass is injection-safe.
ORG_REPO=$(CONFIG_FILE="$CONFIG_FILE" "$NODE_BIN" -e "try{process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.env.CONFIG_FILE,'utf8')).orgRepo||''))}catch{}" 2>/dev/null || echo "")
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
# Defense-in-depth against a teammate-pushed .gitmodules with an ext:: submodule
# URL (ext:: is literal command execution — never legitimate). The orgRepo clone
# URL is already constrained to https/git@ above, so ext:: can't enter via
# ORG_REPO; this closes the submodule-transport class. GIT_CONFIG_* env covers
# gh clone, git clone, and git pull uniformly (gh spawns git as a subprocess that
# inherits the env). --no-recurse-submodules on the direct git clone/pull below
# ensures a pushed .gitmodules is never fetched even if a future change recursed.
# protocol.file is intentionally left at its default so local-path clones (and
# the e2e test's bare remote) keep working — the submodule fetch path is closed
# by --no-recurse-submodules, not by blocking file://.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=protocol.ext.allow
export GIT_CONFIG_VALUE_0=never
GH_TOKEN=$(gh auth token 2>/dev/null || echo "")
[ -n "$GH_TOKEN" ] && export GITHUB_TOKEN="$GH_TOKEN"

mkdir -p "$ORG_VAULT"

if [ ! -d "$ORG_VAULT/.git" ]; then
  if ! gh repo clone "$ORG_REPO" "$ORG_VAULT" -- --no-recurse-submodules --branch "$BRANCH" --depth 1 2>/dev/null; then
    if ! git clone --no-recurse-submodules --branch "$BRANCH" --depth 1 "$ORG_REPO" "$ORG_VAULT" 2>/dev/null; then
      echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Failed to clone org vault."}}'
      exit 0
    fi
  fi
  # The server polls for this marker; drop it so a running session reconciles
  # the newly cloned org memories without requiring a restart.
  touch "$HOME/.total-recall/.reconcile-requested"
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault cloned."}}'
  exit 0
fi

cd "$ORG_VAULT"
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
# Pull with a real success/failure branch. The old form `git pull ... || true`
# swallowed pull failures and then reported "up-to-date" whenever BEFORE==AFTER —
# so a network/auth error looked identical to "nothing new", silently leaving the
# vault stale. Now a failed pull is reported as such (and the local copy is used).
if git pull --ff-only --no-recurse-submodules origin "$BRANCH" 2>/dev/null; then
  AFTER=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [ "$BEFORE" = "$AFTER" ]; then
    echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault up-to-date."}}'
  else
    # Ask the running server to reconcile so teammates' pushed memories surface
    # without a session restart.
    touch "$HOME/.total-recall/.reconcile-requested"
    echo "{\"continue\":true,\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"Org vault updated: $BEFORE -> $AFTER\"}}"
  fi
else
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org vault pull failed (network/auth) — using local copy."}}'
fi
