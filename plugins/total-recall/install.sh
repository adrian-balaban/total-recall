#!/usr/bin/env bash
#
# install.sh — Total Recall complete install & setup
#
# One-shot, state-aware setup for the Total Recall plugin.
# Runs the full first-run initialization in one go:
#   1. Detect plugin path
#   2. Create vault directories
#   3. Register the MCP server
#   4. Build the initial index
#   5. Wire hooks into ~/.claude/settings.json   (standalone installs only)
#   5b. Statusline         (optional, --statusline)
#   6. Org vault            (optional)
#   7. Vector search        (optional)
#   8. Verify
#
# Every step checks current state before acting, so the script is SAFE TO
# RE-RUN on a partially set-up installation.
#
# Usage:
#   ./install.sh [options]
#
# Options:
#   --plugin-root PATH        Path to the total-recall plugin dir
#                             (default: this script's own directory)
#   --standalone              Wire hooks into ~/.claude/settings.json.
#                             Skip this for plugin installs — `claude plugin
#                             install` auto-loads hooks/hooks.json.
#   --statusline              Install the total-recall status line: copies
#                             statusline.sh to ~/.claude/total-recall-statusline.sh
#                             and wires `statusLine` into ~/.claude/settings.json
#                             (shows the plugin version in the bottom bar). Skipped
#                             if a statusLine is already configured.
#   --org-repo URL            Enable the shared org vault from this GitHub repo
#                             (full HTTPS URL ending in .git)
#   --allowed-email-domain D  Allow this work-email domain through the org-vault
#                             privacy filter (default blocks ALL emails)
#   --vector                  Enable hybrid vector search (installs HuggingFace
#                             deps + rebuilds; ~200 MB on first use)
#   --no-vector               Skip vector search without prompting
#   -y, --yes                 Non-interactive: take defaults, skip optional
#                             prompts (org vault / vector search) unless their
#                             flags were given
#   -h, --help                Show this help and exit
#
# Prerequisites:
#   - Node.js v18+
#   - gh CLI authenticated (`gh auth status`) — only for the org vault
#
# --------------------------------------------------------------------------
# What the script does — each checking state first so
# it's safe to re-run:
#
#   1. Detect plugin path — --plugin-root → $CLAUDE_PLUGIN_ROOT → the script's
#      own dir (it ships at the plugin root) → claude mcp get → prompt.
#   2. Create vault dirs — ~/.total-recall/personal-vault/{architecture,
#      decisions,…} + org/; skips if already populated.
#   3. Register MCP server — skips if present; else
#      claude mcp add-json … --scope user, then checks for "Failed to connect".
#   4. Build initial index via hooks/scripts/build-memory-index.sh.
#   5. Hook wiring — --standalone only; merges the SessionStart/PostToolUse/
#      PreCompact entries (mirroring hooks/hooks.json) into
#      ~/.claude/settings.json (preserves build → load ordering). Plugin
#      installs skip it.
#   5b. Statusline (optional, --statusline) — copies statusline.sh to
#      ~/.claude/total-recall-statusline.sh and wires `statusLine` into
#      ~/.claude/settings.json (shows the plugin version in the bottom bar).
#      Skipped if a statusLine is already configured.
#   6. Org vault (optional) — prompts or --org-repo/--allowed-email-domain;
#      writes config.json, runs pull-org-vault.sh.
#   7. Vector search (optional) — prompts or --vector/--no-vector;
#      npm install … && npm run build.
#   8. Verify + a summary of what was set up vs. skipped.
#
# It adds a prerequisite check (Node ≥18, gh auth), flags for non-interactive
# use (-y, --vector, --org-repo, …), and --help.
# --------------------------------------------------------------------------
set -uo pipefail

# --------------------------------------------------------------------------
# Setup / helpers
# --------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
VAULT_HOME="$HOME/.total-recall"
CONFIG_FILE="$VAULT_HOME/config.json"
SETTINGS_FILE="$HOME/.claude/settings.json"

# Defaults / flag state
PLUGIN_ROOT=""
STANDALONE=0
STATUSLINE=0
ORG_REPO=""
ORG_DOMAIN=""
VECTOR=""        # "" = ask, "yes" = install, "no" = skip
ASSUME_YES=0

if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RST=$'\033[0m'
else
  C_BOLD=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RST=""
fi

step() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$1" "$C_RST"; }
info() { printf '  %s\n' "$1"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RST" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RST" "$1"; }
err()  { printf '  %sx%s %s\n' "$C_RED" "$C_RST" "$1" >&2; }
die()  { err "$1"; exit 1; }

# Track what happened for the closing summary
SUMMARY=()
note() { SUMMARY+=("$1"); }

usage() { sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; s/^#$//; /^set -uo/d'; }

# Ask a yes/no question. Honors --yes (returns the supplied default).
# Usage: ask_yes_no "Question?" "y|n"   -> returns 0 for yes, 1 for no
ask_yes_no() {
  local q="$1" default="${2:-n}" reply
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    [ "$default" = "y" ]; return
  fi
  read -rp "  $q [$([ "$default" = y ] && echo Y/n || echo y/N)] " reply
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy] ]]
}

# Prompt for a value (skipped under --yes / non-tty; returns empty there)
ask_value() {
  local q="$1" __var="$2" reply
  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then return; fi
  read -rp "  $q " reply
  printf -v "$__var" '%s' "$reply"
}

# --------------------------------------------------------------------------
# Parse args
# --------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-root)         PLUGIN_ROOT="${2:?--plugin-root needs a path}"; shift 2;;
    --standalone)          STANDALONE=1; shift;;
    --statusline)          STATUSLINE=1; shift;;
    --org-repo)            ORG_REPO="${2:?--org-repo needs a URL}"; shift 2;;
    --allowed-email-domain) ORG_DOMAIN="${2:?--allowed-email-domain needs a domain}"; shift 2;;
    --vector)              VECTOR="yes"; shift;;
    --no-vector)           VECTOR="no"; shift;;
    -y|--yes)              ASSUME_YES=1; shift;;
    -h|--help)             usage; exit 0;;
    *) die "Unknown option: $1  (try --help)";;
  esac
done

# --------------------------------------------------------------------------
# Prerequisites
# --------------------------------------------------------------------------
step "Prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js not found on PATH (need v18+)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js v18+ required (found $(node -v))."
fi
ok "Node.js $(node -v)"
command -v claude >/dev/null 2>&1 || warn "'claude' CLI not found — MCP registration (Step 3) will be skipped."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  ok "gh CLI authenticated"
else
  warn "gh CLI not authenticated — required only for the org vault (Step 6)."
fi

# --------------------------------------------------------------------------
# Step 1 — Detect plugin path
# --------------------------------------------------------------------------
step "Step 1 — Detect plugin path"
if [ -z "$PLUGIN_ROOT" ]; then
  # Prefer an explicit env var, otherwise this script's own directory
  # (install.sh ships at the plugin root).
  PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR}"
  if [ ! -f "$PLUGIN_ROOT/dist/index.js" ] && command -v claude >/dev/null 2>&1; then
    FROM_MCP=$(claude mcp get total-recall 2>/dev/null \
      | grep -o '"[^"]*dist/index.js"' | sed 's|/dist/index.js"||; s|^"||')
    [ -n "$FROM_MCP" ] && PLUGIN_ROOT="$FROM_MCP"
  fi
fi
if [ ! -f "$PLUGIN_ROOT/dist/index.js" ]; then
  ask_value "Path to the total-recall plugin directory?" PLUGIN_ROOT
fi
[ -f "$PLUGIN_ROOT/dist/index.js" ] \
  || die "Could not locate dist/index.js under '$PLUGIN_ROOT'. Pass --plugin-root."
PLUGIN_ROOT="$(cd -- "$PLUGIN_ROOT" && pwd -P)"
ok "Plugin root: $PLUGIN_ROOT"

# --------------------------------------------------------------------------
# Step 2 — Create vault directories
# --------------------------------------------------------------------------
step "Step 2 — Create vault directories"
if [ -d "$VAULT_HOME/personal-vault" ] && [ -n "$(ls -A "$VAULT_HOME/personal-vault" 2>/dev/null)" ]; then
  ok "Vault directories already exist."
else
  mkdir -p "$VAULT_HOME/personal-vault"/{architecture,decisions,troubleshooting,meetings,knowledge,journal}
  mkdir -p "$VAULT_HOME/org"
  ok "Created $VAULT_HOME/personal-vault/{architecture,decisions,troubleshooting,meetings,knowledge,journal} and org/"
  note "Vault directories created."
fi

# --------------------------------------------------------------------------
# Step 3 — Register MCP server
# --------------------------------------------------------------------------
step "Step 3 — Register MCP server"
if ! command -v claude >/dev/null 2>&1; then
  warn "'claude' CLI unavailable — skipping MCP registration."
  note "MCP registration skipped (no claude CLI)."
elif claude mcp get total-recall >/dev/null 2>&1; then
  ok "MCP server 'total-recall' already registered."
else
  # Pick the highest-versioned nvm node, else whatever is on PATH.
  # (The skill's one-liner accidentally *executed* the node binaries; we list
  # the paths instead, which is the intended behavior.)
  NODE_BIN=$(ls ~/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
  info "Using node binary: $NODE_BIN"
  # Build the MCP registration JSON via node + JSON.stringify, passing the two
  # paths through env rather than interpolating them into the literal: a `"` or
  # `\` in $NODE_BIN or $PLUGIN_ROOT (a Windows-style path, an escaped char, an
  # apostrophe in a username) would break the hand-rolled JSON and make
  # `claude mcp add-json` fail — silently skipping registration. JSON.stringify
  # guarantees valid JSON regardless of path content; env-pass avoids any
  # shell/JS injection from the path (mirrors load-memory-index.sh).
  MCP_JSON=$(NODE_BIN="$NODE_BIN" PLUGIN_ROOT="$PLUGIN_ROOT" node -e 'process.stdout.write(JSON.stringify({type:"stdio",command:process.env.NODE_BIN,args:[process.env.PLUGIN_ROOT+"/dist/index.js"]}))')
  if claude mcp add-json total-recall "$MCP_JSON" --scope user; then
    if claude mcp get total-recall 2>&1 | grep -qi 'failed to connect'; then
      warn "MCP server shows 'Failed to connect' — the node path may be wrong: $NODE_BIN"
      warn "Re-run with the correct node, or fix via 'claude mcp remove total-recall' + 'claude mcp add-json ...'."
    else
      ok "Registered MCP server 'total-recall' (user scope)."
    fi
    note "MCP server registered."
  else
    warn "claude mcp add-json failed — register manually if needed."
  fi
fi

# --------------------------------------------------------------------------
# Step 4 — Build initial index
# --------------------------------------------------------------------------
step "Step 4 — Build initial index"
if [ -x "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" ]; then
  if bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh" >/dev/null 2>&1; then
    ok "Built initial memory index."
  else
    warn "build-memory-index.sh exited non-zero (empty vault is fine on first run)."
  fi
else
  warn "build-memory-index.sh not found — skipping index build."
fi

# --------------------------------------------------------------------------
# Step 5 — Hook wiring (standalone only)
# --------------------------------------------------------------------------
step "Step 5 — Hook wiring (standalone only)"
if [ "$STANDALONE" -ne 1 ]; then
  ok "Plugin install — hooks auto-load from hooks/hooks.json. (Pass --standalone to wire manually.)"
else
  info "Merging total-recall hooks into $SETTINGS_FILE"
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  node - "$SETTINGS_FILE" "$PLUGIN_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [, , settingsPath, plugin] = process.argv;
let s = {};
try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
s.hooks = s.hooks || {};
if (JSON.stringify(s.hooks).includes('hooks/scripts/build-memory-index.sh')) {
  console.log('SKIP: total-recall hooks already present.');
  process.exit(0);
}
// String concat, not a template literal: `plugin` is $PLUGIN_ROOT from argv,
// and a backtick or `${` sequence in that path would break the template literal
// and abort the hook-wiring heredoc (silent: hooks never get wired). Plain
// concat is immune to path-content injection.
const cmd = (p, timeout) => ({ type: 'command', command: 'bash ' + plugin + '/hooks/scripts/' + p, timeout });
(s.hooks.SessionStart = s.hooks.SessionStart || []).push({ hooks: [
  cmd('pull-org-vault.sh', 30),
  cmd('build-memory-index.sh', 15),   // must run BEFORE load-memory-index.sh
  cmd('load-memory-index.sh', 5),
  cmd('load-open-questions.sh', 5),
] });
(s.hooks.PostToolUse = s.hooks.PostToolUse || []).push({
  matcher: 'store_memory|update_memory|delete_memory',
  hooks: [ cmd('sync-org-memory.sh', 30) ],
});
(s.hooks.PreCompact = s.hooks.PreCompact || []).push({ hooks: [
  cmd('extract-and-store-memories.sh', 60),
] });
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
console.log('WROTE: total-recall hooks added.');
NODE
  if [ $? -eq 0 ]; then
    ok "Hook wiring complete."
    note "Hooks wired into settings.json (standalone)."
  else
    warn "Hook wiring failed — wire hooks manually to mirror hooks/hooks.json."
  fi
fi

# --------------------------------------------------------------------------
# Step 5b — Statusline (optional, --statusline)
# --------------------------------------------------------------------------
step "Step 5b — Statusline (optional)"
if [ "$STATUSLINE" -ne 1 ]; then
  ok "Statusline skipped. (Pass --statusline to show the total-recall version in the bottom bar.)"
elif [ ! -f "$PLUGIN_ROOT/statusline.sh" ]; then
  warn "statusline.sh not found at $PLUGIN_ROOT/statusline.sh — skipping."
  note "Statusline skipped (source missing)."
else
  LAUNCHER="$HOME/.claude/total-recall-statusline.sh"
  mkdir -p "$(dirname "$LAUNCHER")"
  if cp -f "$PLUGIN_ROOT/statusline.sh" "$LAUNCHER" && chmod +x "$LAUNCHER"; then
    ok "Installed statusline launcher: $LAUNCHER"
  else
    warn "Could not install $LAUNCHER — statusline wiring skipped."
    note "Statusline skipped (copy failed)."
    LAUNCHER=""
  fi
  if [ -n "$LAUNCHER" ]; then
    # Wire `statusLine` into settings.json idempotently — skip if the user
    # already has any statusLine configured (don't clobber a custom one).
    # Mirrors the Step 5 hook-wiring node block: JSON.stringify guarantees
    # valid JSON regardless of the launcher path content.
    node - "$SETTINGS_FILE" "$LAUNCHER" <<'NODE'
const fs = require('fs');
const path = require('path');
const [, , settingsPath, launcher] = process.argv;
let s = {};
try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (_) {}
if (s.statusLine && s.statusLine.command) {
  console.log('SKIP: a statusLine is already configured in settings.json.');
  process.exit(0);
}
s.statusLine = { type: 'command', command: launcher };
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
console.log('WROTE: statusLine wired into settings.json.');
NODE
    if [ $? -eq 0 ]; then
      ok "Wired statusLine into $SETTINGS_FILE"
      note "Statusline installed (shows total-recall version in the bottom bar)."
    else
      warn "settings.json wiring failed — add statusLine manually (see README)."
      note "Statusline launcher installed but settings wiring failed."
    fi
  fi
fi

# --------------------------------------------------------------------------
# Step 6 — Org vault (optional)
# --------------------------------------------------------------------------
step "Step 6 — Org vault (optional)"
ENABLE_ORG=0
if [ -n "$ORG_REPO" ]; then
  ENABLE_ORG=1
elif ask_yes_no "Enable the shared org vault (sync 'org'-tagged memories to GitHub)?" "n"; then
  ENABLE_ORG=1
  ask_value "GitHub repo URL for the org vault (HTTPS, ending in .git)?" ORG_REPO
  warn "The 'org-vault' branch must already exist with at least one commit."
  [ -z "$ORG_DOMAIN" ] && ask_value "Work email domain to allow in org-vault sync (blank = block all)?" ORG_DOMAIN
fi

if [ "$ENABLE_ORG" -eq 1 ] && [ -n "$ORG_REPO" ]; then
  node - "$CONFIG_FILE" "$ORG_REPO" "$ORG_DOMAIN" <<'NODE'
const fs = require('fs');
const [, , cfgPath, repo, domain] = process.argv;
let c = {};
try { c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
c.orgRepo = repo;
if (domain) c.allowedEmailDomains = [domain]; else delete c.allowedEmailDomains;
fs.writeFileSync(cfgPath, JSON.stringify(c, null, 2) + '\n');
NODE
  ok "Wrote orgRepo to $CONFIG_FILE${ORG_DOMAIN:+ (allowing @$ORG_DOMAIN)}"
  if [ -x "$PLUGIN_ROOT/hooks/scripts/pull-org-vault.sh" ]; then
    if bash "$PLUGIN_ROOT/hooks/scripts/pull-org-vault.sh"; then
      ok "Org vault cloned/pulled."
    else
      warn "Clone failed. Check: 'git ls-remote $ORG_REPO org-vault' and 'gh auth status'."
    fi
  fi
  note "Org vault enabled ($ORG_REPO)."
else
  ok "Org vault skipped. Enable later by setting 'orgRepo' in $CONFIG_FILE."
  note "Org vault skipped."
fi

# --------------------------------------------------------------------------
# Step 7 — Vector search (optional)
# --------------------------------------------------------------------------
step "Step 7 — Vector search (optional)"
if [ -z "$VECTOR" ]; then
  if ask_yes_no "Enable hybrid vector search (TF-IDF + HuggingFace embeddings, ~200 MB)?" "n"; then
    VECTOR="yes"; else VECTOR="no"; fi
fi
if [ "$VECTOR" = "yes" ]; then
  info "Installing vector-search dependencies in $PLUGIN_ROOT ..."
  if ( cd "$PLUGIN_ROOT" && npm install @huggingface/transformers sqlite-vec better-sqlite3 && npm run build ); then
    ok "Vector search enabled (TF-IDF + embeddings via RRF)."
    note "Vector search enabled."
  else
    warn "npm install/build failed — plugin will fall back to TF-IDF only."
  fi
else
  ok "Vector search skipped. Plugin uses TF-IDF + Ebbinghaus decay by default."
  note "Vector search skipped."
fi

# --------------------------------------------------------------------------
# Step 8 — Verify
# --------------------------------------------------------------------------
step "Step 8 — Verify"
[ -f "$PLUGIN_ROOT/dist/index.js" ] && ok "dist/index.js present" || warn "dist/index.js missing — run 'npm run build' in $PLUGIN_ROOT"
if command -v claude >/dev/null 2>&1; then
  if claude mcp get total-recall >/dev/null 2>&1; then
    ok "MCP server 'total-recall' is registered"
  else
    warn "MCP server 'total-recall' not registered"
  fi
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
step "Summary"
if [ "${#SUMMARY[@]}" -eq 0 ]; then
  info "Nothing to do — installation already complete."
else
  for line in "${SUMMARY[@]}"; do info "• $line"; done
fi
info ""
info "Done. Start a new Claude Code session to load the injected memory index."
