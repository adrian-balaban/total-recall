#!/usr/bin/env bash
set -euo pipefail

# 4.4 (REVIEW 1.6): surface org-sync push failures at session start.
# sync-org-memory.mjs logs push failures to ~/.total-recall/org/.sync-errors.log
# and exits 0 (the PostToolUse hook backgrounds it, so a non-zero exit would kill
# the hook; stderr is otherwise lost). Nothing read that log, so a recurring push
# failure (network/auth down) was invisible — org memories quietly stopped
# syncing with no signal. This SessionStart hook compares the error log's mtime
# to the last-success marker (.sync-ok, stamped on every non-throwing mjs run):
# if errors arrived AFTER the last success (or there's no success marker yet),
# emit a one-line warning the user sees at session start. No error log / no
# marker / errors older than the last success → silent (preserves the pre-4.4
# no-org-setup and healthy-sync cases). The warning text is STATIC (no
# interpolation of the error line) so a teammate-pushed frontmatter value with a
# quote/backslash can't break the hook's JSON output.

ORG_DIR="$HOME/.total-recall/org"
ERR_LOG="$ORG_DIR/.sync-errors.log"
OK_MARKER="$ORG_DIR/.sync-ok"

if [ ! -f "$ERR_LOG" ]; then
  echo '{"continue":true}'
  exit 0
fi

# stat -c %Y (GNU) / stat -f %m (BSD/macOS) → mtime epoch seconds. Fall back to 0
# (treat as "no marker / unknown") so a stat failure never falsely warns.
err_mtime=$(stat -c %Y "$ERR_LOG" 2>/dev/null || stat -f %m "$ERR_LOG" 2>/dev/null || echo 0)
if [ -f "$OK_MARKER" ]; then
  ok_mtime=$(stat -c %Y "$OK_MARKER" 2>/dev/null || stat -f %m "$OK_MARKER" 2>/dev/null || echo 0)
else
  ok_mtime=0
fi

# Errors arrived after the last success (or no success yet) → warn. Integer
# compare; the stat fallbacks above guarantee numeric strings.
if [ "$err_mtime" -gt "$ok_mtime" ]; then
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Org-sync push failed since the last successful sync — org memories may not be reaching the shared vault. See ~/.total-recall/org/.sync-errors.log."}}'
  exit 0
fi

echo '{"continue":true}'