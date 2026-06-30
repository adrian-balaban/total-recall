#!/usr/bin/env bash
# _resolve-node.sh — shared node resolver, SOURCED (not executed) by hook scripts.
#
# Claude Code spawns hook commands with a minimal PATH that excludes nvm's shim
# dir (nvm only adds itself to PATH via interactive shell init, e.g. ~/.bashrc),
# so a bare `node` is "command not found" and hook scripts that JSON-encode via
# node silently emit empty/degraded output. For the SessionStart hooks that means
# the injected memory index (the plugin's core feature) never reaches Claude —
# the same silent-no-op class fixed in statusline.sh (commit 5827d46).
#
# Mirror statusline.sh: prefer whatever is on PATH, else the highest-versioned
# nvm node, else common system locations. Sets NODE_BIN (exported). If no node is
# found, NODE_BIN is left empty and the caller's existing `||` fallback handles
# the miss (callers already tolerate a failed node invocation).
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ] || ! [ -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ] || ! [ -x "$NODE_BIN" ]; then
  NODE_BIN="$(ls "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE_BIN" ] || ! [ -x "$NODE_BIN" ]; then
  for p in /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node; do
    [ -x "$p" ] && NODE_BIN="$p" && break
  done
fi
export NODE_BIN