#!/usr/bin/env bash
# Runs before context compaction. Extracts 0-3 reusable learnings from the session
# transcript and writes them directly to the personal vault.
#
# Storage is a direct file write (store-learning.mjs), NOT a nested `claude -p --mcp`
# call — that flag does not exist, so the previous version silently stored nothing.
# Files land on disk and are picked up by the next boot's reconcile_index / by an
# explicit rebuild_index.
set -euo pipefail

. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)/_resolve-node.sh"   # sets NODE_BIN (nvm/stripped-PATH safe)

# Claude Code passes hook input as JSON on stdin; transcript_path is a common
# field there (NOT a CLAUDE_TRANSCRIPT_PATH env var — that env var is never set,
# so the previous version always exited here and PreCompact was a permanent
# no-op that stored nothing). Read stdin once, parse transcript_path via node.
HOOK_INPUT=$(cat)
TRANSCRIPT=$(printf '%s' "$HOOK_INPUT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).transcript_path||"")}catch{}})' 2>/dev/null || echo "")

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo '{"continue":true}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Guard: if the `claude` CLI is not on PATH (e.g. hook fired in an environment
# without the binary, or a broken install), `claude -p` below would fail under
# `set -e` and — even with the trailing `|| true` — emit a confusing error to
# the user. Skip cleanly instead; the next compaction will retry.
. "$SCRIPT_DIR/_resolve-claude.sh"   # sets CLAUDE_BIN (PATH, else the VS Code extension's bundled binary)
[ -n "$CLAUDE_BIN" ] || { echo "extract-and-store-memories: claude CLI not found — skipping" >&2; echo '{"continue":true}'; exit 0; }

EXTRACT_PROMPT='You are reviewing a Claude Code session transcript. Extract 0-3 distinct, reusable learnings worth storing as persistent memories.

For each learning output a JSON object on a single line:
{"title": "...", "content": "## Executive Summary\n\n...", "tags": [...], "category": "...", "importanceScore": 0.0-1.0}

Only output JSON lines. No prose. If nothing is worth storing, output nothing.

Rules:
- Only store things with long-term reuse value
- Include WHY, not just WHAT
- Do not store ephemeral task details'

# Spec-driven (specDriven.extractDecisions): also ask for architecture decisions
# with the elements they are about. store-learning.mjs keeps these fields only
# after the same sanitiser the MCP server uses (dist/spec-fields.mjs).
EXTRACT_DECISIONS=$("$NODE_BIN" --input-type=module -e '
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const { pathToFileURL } = await import("node:url");
const { parseSpecConfig } = await import(pathToFileURL(process.argv[1]).href);
let raw; try { raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".total-recall", "config.json"), "utf8")).specDriven; } catch {}
process.stdout.write(parseSpecConfig(raw).extractDecisions ? "1" : "0");
' "$SCRIPT_DIR/../../dist/spec-config.mjs" 2>/dev/null || echo 0)
if [ "$EXTRACT_DECISIONS" = "1" ]; then
  EXTRACT_PROMPT="$EXTRACT_PROMPT
- If the session took an architecture decision, store it with category \"decisions\" and add these optional fields: \"system\" (the ADL system id), \"elements\" (IDs such as \"adl:<domain>.<component>\", \"assert:<ID>\"), \"requirements\" (e.g. \"REQ-7\"), \"artifact\": \"adr\", \"status\": \"accepted\". Include the options that were rejected and why."
fi

# Extract via `claude -p` (valid), then write each JSON line straight to the vault.
# store-learning.mjs validates JSON, slugifies, and skips existing memories.
# Persist node's stderr to ~/.total-recall/.extract.log instead of /dev/null:
# store-learning.mjs emits a "X written, Y skipped, Z errors" summary to stderr
# "for debugging", and any crash/import failure (e.g. a build-drifted missing
# dist/frontmatter.mjs → ERR_MODULE_NOT_FOUND) lands there too. /dev/null
# discarded both, so a persistent extraction failure dropped every PreCompact
# learning with ZERO observable signal — no log, no error, no exit-code change
# (the trailing `|| true` still swallows the exit). Mirror sync-org-memory.sh,
# which persists its backgrounded children's stderr to ~/.total-recall/org/.sync.log
# for the same discoverability. stdout stays clean (the hook only emits the
# final {"continue":true}); only stderr is tee'd to the log.
EXTRACT_LOG="$HOME/.total-recall/.extract.log"
# Which lifecycle event ran this extraction: PreCompact (default) or SessionEnd,
# which re-runs this script detached (session-end.sh). Sanitised: it lands in a
# log line that check-extract-outcomes.sh greps.
TRIGGER=$(printf '%s' "${TR_EXTRACT_TRIGGER:-precompact}" | tr -cd 'a-z-')
TRIGGER=${TRIGGER:-precompact}
# Cap the transcript fed to `claude -p`. A long session's transcript.jsonl grows
# past claude -p's stdin limit ("piped stdin input exceeds 10MB") — observed
# failing every extraction on large sessions, with the error line then counted as
# a bogus store-learning error. Feed only the most recent ~1MB (tail -c): the
# recent turns are what a PreCompact extraction should summarize anyway, and 1MB
# is comfortably under the limit while still spanning many turns. tail -c may slice
# mid-line, but the transcript is JSONL and claude -p reads it as free-form context
# (not strict JSON), so a truncated first line is harmless.
MAX_BYTES=1048576
MAX_LOG_LINES=1000

# Observability (E1): the run must leave ONE line saying what happened. A run that
# writes nothing is otherwise ambiguous — the model had nothing worth storing, its
# output was dropped (a JSON array, prose), or `claude -p` failed (its exit code
# used to be swallowed by `|| true`). store-learning's stderr goes to a temp file so
# its summary can be parsed; it is appended to the log afterwards, so crash text
# (e.g. ERR_MODULE_NOT_FOUND) still lands there. set +e only around the pipeline so
# PIPESTATUS can be read; the hook still always ends with {"continue":true}.
STORE_ERR=$(mktemp)
trap 'rm -f "$STORE_ERR"' EXIT
# Sandbox (Technology Radar Vol 35, Adopt: agent sandboxing). The transcript holds web pages
# and tool output, so text planted there could steer this run. It only has to print JSON
# lines, so it gets no tools (`--tools ""`), no MCP servers (`--strict-mcp-config`, none are
# passed), no skills and no saved session. A claude CLI too old to know these flags fails
# here with outcome=cli-error, which the SessionStart alarm reports: fail closed on purpose.
set +e
# TR_EXTRACT_RUNNING=1: the nested `claude -p` is itself a Claude Code session and
# fires SessionEnd; session-end.sh sees this flag and does not spawn another
# extraction (otherwise every extraction would recurse).
TR_EXTRACT_RUNNING=1 "$CLAUDE_BIN" -p "$EXTRACT_PROMPT" --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence \
  < <(tail -c "$MAX_BYTES" "$TRANSCRIPT") 2>>"$EXTRACT_LOG" \
  | "$NODE_BIN" "$SCRIPT_DIR/store-learning.mjs" 2>"$STORE_ERR"
CLAUDE_RC=${PIPESTATUS[0]}
set -e
cat "$STORE_ERR" >>"$EXTRACT_LOG" 2>/dev/null || true

SUMMARY=$(grep -o 'store-learning: .*' "$STORE_ERR" 2>/dev/null | tail -1 || true)
field() { printf '%s' "$SUMMARY" | sed -nE "s/.*[:,] ([0-9]+) $1.*/\1/p"; }
N_WRITTEN=$(field written); N_SKIPPED=$(field skipped); N_ERRORS=$(field errors); N_DROPPED=$(field dropped)
N_WRITTEN=${N_WRITTEN:-0}; N_SKIPPED=${N_SKIPPED:-0}; N_ERRORS=${N_ERRORS:-0}; N_DROPPED=${N_DROPPED:-0}
if [ "$N_WRITTEN" -gt 0 ]; then OUTCOME=wrote
elif [ "${CLAUDE_RC:-0}" -ne 0 ]; then OUTCOME=cli-error
elif [ -z "$SUMMARY" ]; then OUTCOME=store-error
elif [ "$N_DROPPED" -gt 0 ] || [ "$N_ERRORS" -gt 0 ]; then OUTCOME=dropped
else OUTCOME=nothing; fi
VERSION=$(PKG="$SCRIPT_DIR/../../package.json" "$NODE_BIN" -e 'try{process.stdout.write(String(require(process.env.PKG).version||"unknown"))}catch{process.stdout.write("unknown")}' 2>/dev/null || echo unknown)
SESSION=$(printf '%s' "$HOOK_INPUT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).session_id||"").replace(/[^A-Za-z0-9_-]/g,""))}catch{}})' 2>/dev/null || true)
printf '%s v%s session=%s outcome=%s written=%s skipped=%s errors=%s dropped=%s claude_rc=%s trigger=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$VERSION" "${SESSION:-unknown}" "$OUTCOME" \
  "$N_WRITTEN" "$N_SKIPPED" "$N_ERRORS" "$N_DROPPED" "${CLAUDE_RC:-0}" "$TRIGGER" >>"$EXTRACT_LOG" 2>/dev/null || true

# E5: keep the log bounded — only the last MAX_LOG_LINES lines survive.
if [ "$(wc -l <"$EXTRACT_LOG" 2>/dev/null || echo 0)" -gt "$MAX_LOG_LINES" ]; then
  LOG_TMP=$(mktemp "${EXTRACT_LOG}.tmp.XXXXXXXXXX")
  tail -n "$MAX_LOG_LINES" "$EXTRACT_LOG" >"$LOG_TMP" && mv -f "$LOG_TMP" "$EXTRACT_LOG" || rm -f "$LOG_TMP"
fi

echo '{"continue":true}'
