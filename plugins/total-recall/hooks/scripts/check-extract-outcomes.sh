#!/usr/bin/env bash
set -euo pipefail

# E4: surface PreCompact extraction failures at session start. extract-and-store-
# memories.sh appends one `... outcome=<wrote|nothing|dropped|cli-error|store-error> ...`
# line per run to ~/.total-recall/.extract.log. When at least FAIL_MIN of the last
# WINDOW runs ended in `cli-error`, `store-error` or `dropped` (the model answered but
# nothing was parseable), tell the user once per session start: otherwise a persistent
# failure just means "nothing was ever stored" with no signal. A single chatty run
# (one `dropped`) is normal, hence the window. No log, no outcome lines (an old log
# from before 1.6.4) or a healthy window → silent. The warning text is STATIC, like
# check-sync-errors.sh, so log content can never break the hook's JSON output.

LOG="$HOME/.total-recall/.extract.log"
WINDOW=5
FAIL_MIN=3

if [ ! -f "$LOG" ]; then
  echo '{"continue":true}'
  exit 0
fi

FAILED=$(grep ' outcome=' "$LOG" 2>/dev/null | tail -n "$WINDOW" | grep -cE ' outcome=(cli-error|store-error|dropped) ' || true)

if [ "${FAILED:-0}" -ge "$FAIL_MIN" ]; then
  echo '{"continue":true,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"PreCompact memory extraction has failed or produced unusable output in most of its recent runs, so learnings are not being saved. See the latest outcome= lines in ~/.total-recall/.extract.log."}}'
  exit 0
fi

echo '{"continue":true}'
