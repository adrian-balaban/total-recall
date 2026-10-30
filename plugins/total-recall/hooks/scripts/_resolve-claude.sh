#!/usr/bin/env bash
# _resolve-claude.sh — shared `claude` CLI resolver, SOURCED (not executed).
#
# The Claude Code VS Code extension ships its own claude binary under
# ~/.vscode*/extensions/anthropic.claude-code-*/resources/native-binary/, which is
# not on PATH. Prefer PATH, else the newest bundled/installed binary. Sets
# CLAUDE_BIN (exported); empty when none is found, so callers keep their existing
# "claude not found" fallback.
CLAUDE_BIN="${CLAUDE_BIN:-}"
if [ -z "$CLAUDE_BIN" ] || ! [ -x "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
fi
if [ -z "$CLAUDE_BIN" ] || ! [ -x "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(ls "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude \
                   "$HOME"/.vscode-insiders/extensions/anthropic.claude-code-*/resources/native-binary/claude \
                   "$HOME"/.cursor/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)" || true
fi
if [ -z "$CLAUDE_BIN" ] || ! [ -x "$CLAUDE_BIN" ]; then
  for p in "$HOME/.local/bin/claude"; do
    [ -x "$p" ] && CLAUDE_BIN="$p" && break
  done
fi
[ -x "${CLAUDE_BIN:-}" ] || CLAUDE_BIN=""
export CLAUDE_BIN
