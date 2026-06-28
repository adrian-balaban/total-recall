#!/usr/bin/env bash
# Single-pass awk scanner across both vaults. Reads only frontmatter.
set -euo pipefail

PERSONAL_VAULT="$HOME/.total-recall/personal-vault"
ORG_VAULT="$HOME/.total-recall/org/org-vault"
CACHE="$HOME/.total-recall/.index-cache.txt"

# Must stay in sync with EXCLUDED_DIRS in src/paths.ts — these directories are
# skipped by the TS reconcileIndex walk, and the cache builder must skip them
# too or it injects hidden memories (e.g. .obsidian, projects, templates) into
# the SessionStart index that the MCP tools never surface.
EXCLUDED_DIRS='projects templates .obsidian reference-docs in-progress completed'

# Build a find prune clause: \( -name projects -o -name templates -o ... \) -prune
# Names are simple tokens (no spaces/glob metachars), so unquoted word-splitting of
# $PRUNE into the find expression is safe and intentional.
PRUNE=""
for d in $EXCLUDED_DIRS; do
  if [ -z "$PRUNE" ]; then PRUNE="-name $d"; else PRUNE="$PRUNE -o -name $d"; fi
done

TMP=$(mktemp)
# Body accumulation temp ($TMP) and the atomic-cache write temp ($CACHE_TMP,
# set near the write) must not leak on early exit under `set -e`. CACHE_TMP may
# be unset if we fail before defining it.
cleanup() { rm -f "$TMP" "${CACHE_TMP:-}" 2>/dev/null || true; }
trap cleanup EXIT
COUNT=0

process_vault() {
  local base="$1"
  local prefix="$2"
  # `return 0`, not bare `return`: a bare `return` propagates the `[ -d ]`
  # failure status (1) when the vault dir is absent — and `process_vault` is
  # called as a standalone command under `set -e`, so that 1 aborts the whole
  # SessionStart cache build before the cache is written. The org vault dir is
  # regularly absent (personal-only installs, or before `--org-repo` setup), so
  # this left those users with a stale/missing injected index. An absent vault
  # means "no memories from this vault" — success, not failure.
  [ -d "$base" ] || return 0
  while IFS= read -r -d '' mdfile; do
    local rel="${mdfile#$base/}"
    local key="$prefix${rel%.md}"
    local in_fm=0
    local title="" tags="" category=""
    category=$(dirname "$rel")
    [ "$category" = "." ] && category="knowledge"

    while IFS= read -r fmline; do
      if [ "$fmline" = "---" ]; then
        [ $in_fm -eq 0 ] && { in_fm=1; continue; } || break
      fi
      [ $in_fm -eq 0 ] && continue
      case "$fmline" in
        title:*) title="${fmline#title: }"
                 # frontmatter.ts serializes string scalars as "..." — strip one
                 # pair of surrounding quotes so the cache title matches what
                 # list_memories returns (otherwise the injected index shows
                 # "Protected Org" with the literal quote characters).
                 title="${title#\"}"; title="${title%\"}"
                 title="${title#\'}"; title="${title%\'}" ;;
        tags:*)  tags="${fmline#tags: }"
                 # inline arrays serialize as [a, b, c] — strip the brackets so
                 # the cache doesn't render "[kafka,  streaming]" with artifacts.
                 tags="${tags#\[}"; tags="${tags%\]}" ;;
      esac
    done < "$mdfile"

    [ -z "$title" ] && title=$(basename "$key")
    title="${title:0:40}"
    # Trim each tag (strip the leading space left after comma-splitting) so the
    # cache shows "kafka, streaming" not "kafka,  streaming". Build the joined
    # string in a plain loop instead of a ternary inside printf: the previous
    # form `printf "%s%s",$i,(i<NF&&i<3?", ":"")` had a `,` where the ternary `:`
    # belonged, which gawk (and mawk) reject as a syntax error — under `set -e`
    # that aborted the whole SessionStart cache build, leaving the injected
    # index stale/missing. The loop form is portable across awk implementations
    # and avoids the fragile ternary-in-printf construct entirely.
    tags_short=$(echo "$tags" | awk -F',' '{out=""; for(i=1;i<=NF;i++){t=$i; gsub(/^[ \t]+|[ \t]+$/,"",t); if(i<=3) out=out (i>1?", ":"") t} if(NF>3) out=out ", ..."; print out}')

    echo "- $key: $title [$tags_short] ($category)" >> "$TMP"
    COUNT=$((COUNT + 1))
  # -type f excludes symlinked .md (type l): keeps this cache builder in sync with
  # the TS reconcileIndex walk (src/vault-scan.ts), which skips symlinks so the MCP
  # tools never surface them — without -type f the injected index would advertise a
  # memory the tools then can't find. It also avoids a `set -e` crash: a dangling
  # symlink in the shared org vault (a teammate can plant one via git pull, which
  # preserves symlinks) makes `done < "$mdfile"` above fail to open and abort the
  # whole SessionStart cache build, leaving the injected index stale/missing.
  done < <(find "$base" -type d \( $PRUNE \) -prune -o -type f -name '*.md' -print0 2>/dev/null)
}

process_vault "$PERSONAL_VAULT" ""
process_vault "$ORG_VAULT" "org/"

mkdir -p "$(dirname "$CACHE")"
# Atomic cache write (A8): write to a sibling temp then rename into place. A
# truncated/interrupted `> "$CACHE"` left a partial cache that the SessionStart
# hook then injected as context; the rename is atomic on POSIX so readers never
# see a half-written file. Use a distinct temp from the body `$TMP`.
CACHE_TMP="${CACHE}.tmp.$$"
{ echo "$COUNT"; cat "$TMP"; } > "$CACHE_TMP"
mv -f "$CACHE_TMP" "$CACHE"
rm -f "$TMP"
