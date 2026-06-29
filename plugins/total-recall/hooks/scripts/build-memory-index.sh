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

# Build a find prune clause: \( -iname projects -o -iname templates -o ... \) -prune
# Names are simple tokens (no spaces/glob metachars), so unquoted word-splitting of
# $PRUNE into the find expression is safe and intentional.
# -iname (case-insensitive), NOT -name: the TS reconcileIndex walk in
# src/vault-scan.ts checks `EXCLUDED_DIRS.has(e.name.toLowerCase())`, so a
# mixed-case dir like `Projects` or `.Obsidian` IS skipped by the MCP tools but
# would NOT be pruned by a case-sensitive `find -name projects` — the cache
# builder would then index its .md files and inject them into the SessionStart
# index as memories the tools never surface (the exact desync this script's
# header comment warns against). -iname matches the TS lowercasing so the two
# stay in sync regardless of the on-disk casing.
PRUNE=""
for d in $EXCLUDED_DIRS; do
  if [ -z "$PRUNE" ]; then PRUNE="-iname $d"; else PRUNE="$PRUNE -o -iname $d"; fi
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
    # Track an open block-sequence array (tags:\n  - a\n  - b). Only `tags` is
    # surfaced by this cache, so only one block key is tracked at a time — same
    # single-open-array assumption as src/frontmatter.ts parseYamlish.
    local in_tags_block=0
    local title="" tags="" category=""
    category=$(dirname "$rel")
    [ "$category" = "." ] && category="knowledge"

    while IFS= read -r fmline; do
      # CRLF line endings: a teammate on Windows can push a .md with CRLF to the
      # shared org vault (git preserves the CR). `read -r` strips only the LF
      # delimiter, leaving a trailing \r on fmline — which would then leak into
      # the title/tags values (e.g. tags="kafka\r") and render as artifacts in
      # the injected index. Strip a trailing CR before any matching. The TS
      # parser splits on /\r?\n/ so it is immune; this keeps the shell cache in
      # parity with what list_memories returns.
      fmline="${fmline%$'\r'}"
      if [ "$fmline" = "---" ]; then
        [ $in_fm -eq 0 ] && { in_fm=1; continue; } || break
      fi
      [ $in_fm -eq 0 ] && continue
      # Block-sequence item ("  - x") for the open block-array key (tags only,
      # the only array field this cache surfaces). Mirrors the block-array branch
      # in src/frontmatter.ts parseYamlish: a teammate-pushed or hand-edited
      # memory may carry block-form tags (tags:\n  - a\n  - b) instead of the
      # inline [a, b] the TS writer emits; without this branch the cache showed
      # empty tags for those memories while list_memories showed the real ones.
      # A non-indented line or a new `key:` closes the block (fall-through below).
      if [ $in_tags_block -eq 1 ]; then
        if [[ "$fmline" =~ ^[[:space:]]+-[[:space:]]+(.*)$ ]]; then
          item="${BASH_REMATCH[1]}"
          # strip one pair of surrounding single/double quotes (serializer emits single)
          item="${item#\"}"; item="${item%\"}"
          item="${item#\'}"; item="${item%\'}"
          if [ -z "$tags" ]; then tags="$item"; else tags="$tags, $item"; fi
          continue
        else
          in_tags_block=0
        fi
      fi
      case "$fmline" in
        title:*) title="${fmline#title: }"
                 # frontmatter.ts serializes string scalars as "..." — strip one
                 # pair of surrounding quotes so the cache title matches what
                 # list_memories returns (otherwise the injected index shows
                 # "Protected Org" with the literal quote characters).
                 title="${title#\"}"; title="${title%\"}"
                 title="${title#\'}"; title="${title%\'}" ;;
        tags:*)  tags="${fmline#tags:}"
                 tags="${tags# }"
                 if [ -z "$tags" ]; then
                   # Empty value → block-sequence form; following "  - x" lines
                   # attach (handled above). Inline `[a, b]` is the else branch.
                   in_tags_block=1
                 else
                   in_tags_block=0
                   # inline arrays serialize as [a, b, c] — strip the brackets so
                   # the cache doesn't render "[kafka,  streaming]" with artifacts.
                   tags="${tags#\[}"; tags="${tags%\]}"
                 fi ;;
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
# Random tmp name via mktemp (a sibling of $CACHE so the rename is atomic on the
# same FS): a predictable `${CACHE}.tmp.$$` lets a local attacker who can write
# the vault dir pre-plant a symlink at that path → an outside file, and `>
# "$CACHE_TMP"` would follow it and clobber the target. mktemp's random suffix
# makes the path unguessable, closing the symlink race. Mirrors the TS/.cjs
# atomicWrite random-tmp fix.
CACHE_TMP=$(mktemp "${CACHE}.tmp.XXXXXXXXXX")
{ echo "$COUNT"; cat "$TMP"; } > "$CACHE_TMP"
mv -f "$CACHE_TMP" "$CACHE"
rm -f "$TMP"
