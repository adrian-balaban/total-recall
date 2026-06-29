#!/usr/bin/env bash
# statusline.sh — total-recall status line for Claude Code.
#
# Renders the bottom status bar, including the total-recall plugin version.
# Claude Code pipes a session JSON object on stdin; this script prints a single
# line to stdout (the status bar). See:
#   https://docs.claude.com/en/docs/claude-code/statusline
#
# VERSION ROBUSTNESS — why this survives `claude plugin update`:
# The version is read from ~/.claude/plugins/installed_plugins.json (the LIVE
# plugin registry), NOT from a version-pinned cache path. `claude plugin
# update` writes the new version + installPath there, so this always reflects
# the currently installed version — even though install.sh deploys this script
# to the STABLE path ~/.claude/total-recall-statusline.sh, so the
# `statusLine.command` reference in ~/.claude/settings.json never breaks when
# the plugin moves under a new version-pinned cache dir (e.g. .../1.0.24/ ->
# .../1.0.25/). The script is self-contained: it does not depend on its own
# location, so a stale deployed copy still reads the current registry version.
#
# Installed by install.sh (--statusline). Output shape:
#   <dir>  git:(<branch>)  <model>  total-recall v<version>
set -uo pipefail

# Claude Code's session JSON arrives on stdin. Read it into an env var so the
# `node - <<'NODE'` heredoc below can use node's stdin for the script body
# (the quoted heredoc keeps ${}/backticks in the JS literal — no shell
# expansion of the script body, same pattern as install.sh's hook wiring).
export TR_SESSION="$(cat)"
INSTALLED_FILE="$HOME/.claude/plugins/installed_plugins.json"

node - "$INSTALLED_FILE" <<'NODE'
const fs = require('fs');
const { execSync } = require('child_process');
const installedFile = process.argv[2];

// Session JSON (env-passed; see comment above).
let session = {};
try { session = JSON.parse(process.env.TR_SESSION || '{}'); } catch (_) {}

const cwd = (session.workspace && session.workspace.current_dir)
         || session.cwd
         || process.cwd();
const model = (session.model && session.model.display_name) || '';

// Resolve the live total-recall version from the plugin registry. Tolerant of
// the wrapping object name and of array/object value shapes: walk the whole
// tree for the first key starting with "total-recall@" and take its entry.
let version = 'unknown';
let installPath = null;
try {
  const reg = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (k.startsWith('total-recall@')) {
        const v = o[k];
        const entry = Array.isArray(v) ? v[0] : v;
        if (entry && typeof entry === 'object') {
          if (version === 'unknown' && entry.version) version = String(entry.version);
          if (!installPath && entry.installPath) installPath = entry.installPath;
        }
      } else {
        walk(o[k]);  // recurse into nested objects/arrays
      }
    }
  };
  walk(reg);
} catch (_) {}

// Fallback: registry entry exists but has no version field -> read package.json
// from the live installPath (still not version-pinned: installPath comes from
// the registry, which is current).
if (version === 'unknown' && installPath) {
  try {
    version = String(JSON.parse(fs.readFileSync(installPath + '/package.json', 'utf8')).version || 'unknown');
  } catch (_) {}
}

// Current git branch (best-effort; empty if cwd isn't a repo). cwd is passed as
// an execSync option, not shell-interpolated, so special chars are safe;
// stdio suppresses git's stderr so a non-repo cwd produces no output pollution.
let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch (_) {}

// Dir as ~ relative to home when inside it, else basename.
const home = process.env.HOME || '';
let dir = cwd;
if (home && (cwd === home || cwd.startsWith(home + '/'))) dir = '~' + cwd.slice(home.length);
else { const parts = cwd.replace(/\/+$/, '').split('/'); dir = parts[parts.length - 1] || cwd; }

const segs = [dir];
if (branch) segs.push('git:(' + branch + ')');
if (model) segs.push(model);
segs.push('total-recall v' + version);
console.log(segs.join('  '));
NODE