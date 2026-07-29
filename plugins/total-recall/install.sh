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
#   5c. Gemini extension   (optional, --gemini)
#   6. Org vault            (optional)
#   7. Vector search        (default on; provider auto-detected)
#   8. Verify
#
# Every step checks current state before acting, so the script is SAFE TO
# RE-RUN on a partially set-up installation.
#
# Usage:
#   ./install.sh [options]
#
# On start (interactive, unless a profile flag or --vector/--no-vector/-y is
# given) the script asks which install profile you want:
#   a. Minimal  — no optional dependencies, no local LLM. TF-IDF + Ebbinghaus
#                 search only; smallest footprint, works air-gapped.
#   b. Complete — DEFAULT. Hybrid vector search. Embeddings come from a local
#                 in-process HuggingFace MiniLM via @huggingface/transformers
#                 (~200 MB on first use); sqlite-vec + better-sqlite3 back the
#                 vector store. No external service, no daemon to run.
#
# Options:
#   --complete                Non-interactive profile b (hybrid vector search,
#                             local HuggingFace embeddings). Same as --vector.
#                             This is the default when no profile is chosen.
#   --default                 Alias for --complete (the default profile = hybrid
#                             vector search with the local embedder). Kept so a
#                             bare "install the default" maps to semantic-on.
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
#   --gemini                  Install the plugin as a Gemini CLI extension.
#                             Equivalent to `gemini extensions install <plugin-root>`
#                             — copies the dir into ~/.gemini/extensions/total-recall/
#                             and registers the MCP server + hooks (hooks/hooks.gemini.json)
#                             automatically. Requires the `gemini` CLI on PATH.
#   --org-repo URL            Enable the shared org vault from this GitHub repo
#                             (full HTTPS URL ending in .git)
#   --allowed-email-domain D  Allow this work-email domain through the org-vault
#                             privacy filter (default blocks ALL emails)
#   --vector                  Enable hybrid vector search (local HuggingFace
#                             MiniLM embeddings, ~200 MB on first use)
#   --no-vector               Skip vector search without prompting
#   -y, --yes                 Non-interactive: take defaults (Complete profile
#                             with vector search), skip optional prompts (org
#                             vault) unless their flags were given
#   -h, --help                Show this help and exit
#
# Windows:
#   Run this script from Git Bash (ships with Git for Windows). Claude Code on
#   Windows also runs the plugin hooks through Git Bash, so having it installed
#   covers both. Notes:
#     - `flock` is not available in Git Bash — org-sync coalescing degrades
#       gracefully to one sync per write (handled in sync-org-memory.sh).
#     - Use a Windows Node.js (node.exe on PATH); WSL node won't be visible.
#
# Prerequisites:
#   - Node.js v18+
#   - gh CLI authenticated (`gh auth status`) — only for the org vault
#   - gemini CLI on PATH — only for --gemini
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
#   5c. Gemini CLI extension (optional, --gemini) — runs
#      `gemini extensions install <plugin-root>`, which copies the plugin
#      dir into ~/.gemini/extensions/total-recall/ and registers the MCP
#      server (from gemini-extension.json) and the hooks (from
#      hooks/hooks.gemini.json) automatically. Skipped if `gemini` is not
#      on PATH. The hooks file uses Gemini's event-name renames
#      (PostToolUse→AfterTool, PreCompact→PreCompress) and a full
#      mcp_total-recall_* matcher; the script bodies are the same as
#      the Claude Code hook scripts.
#   6. Org vault (optional) — prompts or --org-repo/--allowed-email-domain;
#      writes config.json, runs pull-org-vault.sh.
#   7. Vector search (default on) — --vector/--no-vector or the profile choice;
#      installs sqlite-vec + better-sqlite3 + @huggingface/transformers (local
#      HuggingFace MiniLM embedder), then npm run build.
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
ORG_DOMAIN_CLEARED=0  # set to 1 only when the user explicitly blanks the work domain
VECTOR=""        # "" = ask, "yes" = install, "no" = skip
ASSUME_YES=0
GEMINI=0         # --gemini: install the extension into ~/.gemini/extensions/

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
    --gemini)              GEMINI=1; shift;;
    --org-repo)            ORG_REPO="${2:?--org-repo needs a URL}"; shift 2;;
    --allowed-email-domain) ORG_DOMAIN="${2:?--allowed-email-domain needs a domain}"; shift 2;;
    --vector|--complete|--default)   VECTOR="yes"; shift;;
    --no-vector) VECTOR="no"; shift;;
    -y|--yes)              ASSUME_YES=1; shift;;
    -h|--help)             usage; exit 0;;
    *) die "Unknown option: $1  (try --help)";;
  esac
done

# --------------------------------------------------------------------------
# Step 0 — Install profile
# --------------------------------------------------------------------------
# Ask up front which profile to install, unless the choice is already implied
# by a flag (--vector/--no-vector/--complete) or -y (defaults apply).
if [ -z "$VECTOR" ] && [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then
  step "Install profile"
  info "a. Minimal  — no optional dependencies, no local LLM (TF-IDF search only)"
  info "b. Complete — hybrid vector search; local HuggingFace MiniLM embeddings (~200 MB on first use, no external service)"
  read -rp "  Which profile? [a/B] " PROFILE_REPLY
  case "${PROFILE_REPLY:-b}" in
    [Aa]*) VECTOR="no";  ok "Profile: minimal (no optional dependencies)";;
    *)     VECTOR="yes"; ok "Profile: complete (hybrid vector search)";;
  esac
fi
# Non-interactive (-y or no tty) with no explicit --vector/--no-vector flag:
# the default profile is Complete (hybrid vector search).
[ -z "$VECTOR" ] && VECTOR="yes"

# --------------------------------------------------------------------------
# Prerequisites
# --------------------------------------------------------------------------
step "Prerequisites"
# Windows (Git Bash / MSYS) awareness — the script works there, with caveats.
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    info "Windows (Git Bash) detected."
    command -v flock >/dev/null 2>&1 \
      || warn "'flock' not available — org-sync coalescing degrades to one sync per write (safe)."
    ;;
esac
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
# `gemini` is optional — only required if --gemini is passed. Warn-but-don't-fail
# so non-Gemini users don't see a hard error.
command -v gemini >/dev/null 2>&1 || warn "'gemini' CLI not found on PATH — required only for --gemini (Step 5c)."

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

# Surface which version is actually being installed. A resolved PLUGIN_ROOT
# inside the Claude plugin cache is pinned to the git SHA of the last
# `claude plugin update` and can silently lag a newer checkout — this has
# happened (a --standalone run wired 1.0.101 while the repo was at 1.0.105).
PLUGIN_VERSION=$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1]+"/.claude-plugin/plugin.json","utf8")).version||"unknown")}catch{process.stdout.write("unknown")}' "$PLUGIN_ROOT" 2>/dev/null || echo unknown)
info "Plugin version: $PLUGIN_VERSION"
case "$PLUGIN_ROOT" in
  */.claude/plugins/cache/*)
    warn "PLUGIN_ROOT is inside the Claude plugin cache — this copy is pinned to the last 'claude plugin update' and may lag the repo."
    warn "If you have a checkout, re-run this script from there (or pass --plugin-root <checkout>/plugins/total-recall)."
    ;;
esac

# Detect an active plugin-manager install of total-recall. Running install.sh's
# MCP/hook wiring on top of it produces TWO servers and DOUBLE index injection
# per session (the plugin's .mcp.json + the user-scope registration below).
PLUGIN_MANAGED=0
INSTALLED_PLUGINS_FILE="$HOME/.claude/plugins/installed_plugins.json"
if [ -f "$INSTALLED_PLUGINS_FILE" ]; then
  if node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(Object.keys(d.plugins||{}).some(k=>k.split("@")[0]==="total-recall")?0:1)' "$INSTALLED_PLUGINS_FILE" 2>/dev/null; then
    PLUGIN_MANAGED=1
  fi
fi
if [ "$PLUGIN_MANAGED" -eq 1 ] && [ "$STANDALONE" -eq 1 ]; then
  warn "total-recall is already installed via the Claude plugin manager."
  warn "Continuing with --standalone would run TWO MCP servers and inject the memory index twice per session."
  if ask_yes_no "Continue with --standalone anyway?" "n"; then
    warn "Proceeding — consider 'claude plugin uninstall total-recall' to avoid duplicates."
  else
    die "Aborted. Either uninstall the plugin first ('claude plugin uninstall total-recall') or re-run without --standalone."
  fi
fi

# --------------------------------------------------------------------------
# Step 2 — Create vault directories
# --------------------------------------------------------------------------
step "Step 2 — Create vault directories"
PERSONAL_VAULT="$VAULT_HOME/personal-vault"
ORG_VAULT="$VAULT_HOME/org/org-vault"
ORG_DIR="$VAULT_HOME/org"

# Initialize config.json defaults if they do not exist
mkdir -p "$VAULT_HOME"
NODE_BIN=$(command -v node || echo "")
if [ -n "$NODE_BIN" ]; then
  "$NODE_BIN" - "$CONFIG_FILE" <<'NODE'
const fs = require('fs');
const [, , cfgPath] = process.argv;
let c = {};
try { c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
let modified = false;
// Migrate any pre-Phase-0 Ollama config keys out, so an existing install.sh
// re-run cleans up an old config.json instead of leaving stale Ollama knobs
// that no longer exist in TotalRecallConfig.
for (const k of ['embeddingProvider', 'embeddingUrl', 'embeddingTimeoutMs']) {
  if (c[k] !== undefined) { delete c[k]; modified = true; }
}
// bge-m3 / nomic-embed-text were Ollama-only model names; clear a stale
// embeddingModel so the local HuggingFace default (Xenova/all-MiniLM-L6-v2)
// applies. An explicit non-Ollama model value is preserved.
if (c.embeddingModel === 'bge-m3' || c.embeddingModel === 'nomic-embed-text') {
  delete c.embeddingModel; modified = true;
}
if (c.enableMultilingualSearch === undefined) { c.enableMultilingualSearch = true; modified = true; }
if (modified) {
  const tmp = cfgPath + '.tmp.' + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n');
  fs.renameSync(tmp, cfgPath);
}
NODE
fi

if [ -f "$CONFIG_FILE" ]; then
  NODE_BIN=$(command -v node || echo "")
  if [ -n "$NODE_BIN" ]; then
    PERSONAL_VAULT=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); let p=c.personalVault; if(p){ p=p.replace(/^~(?=\/|$)/, require('os').homedir()); p=require('path').resolve(p); } console.log(p || '$PERSONAL_VAULT'); } catch { console.log('$PERSONAL_VAULT'); }")
    ORG_VAULT=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); let p=c.orgVault; if(p){ p=p.replace(/^~(?=\/|$)/, require('os').homedir()); p=require('path').resolve(p); } console.log(p || '$ORG_VAULT'); } catch { console.log('$ORG_VAULT'); }")
    ORG_DIR=$(dirname "$ORG_VAULT")
  fi
fi

if [ -d "$PERSONAL_VAULT" ] && [ -n "$(ls -A "$PERSONAL_VAULT" 2>/dev/null)" ]; then
  ok "Vault directories already exist."
else
  mkdir -p "$PERSONAL_VAULT"/{architecture,decisions,troubleshooting,meetings,knowledge,journal}
  mkdir -p "$ORG_DIR"
  ok "Created $PERSONAL_VAULT/{architecture,decisions,troubleshooting,meetings,knowledge,journal} and $ORG_DIR/"
  note "Vault directories created."
fi

# --------------------------------------------------------------------------
# Step 3 — Register MCP server
# --------------------------------------------------------------------------
step "Step 3 — Register MCP server"
if ! command -v claude >/dev/null 2>&1; then
  warn "'claude' CLI unavailable — skipping MCP registration."
  note "MCP registration skipped (no claude CLI)."
elif [ "$PLUGIN_MANAGED" -eq 1 ] && [ "$STANDALONE" -ne 1 ]; then
  # The plugin manager already provides the server via the plugin's .mcp.json —
  # a user-scope registration on top of it would start a second server and
  # inject the memory index twice per session. Clean up any stale one instead.
  if claude mcp get total-recall >/dev/null 2>&1; then
    info "Removing user-scope MCP registration (duplicate of the plugin-managed server)."
    claude mcp remove total-recall -s user 2>/dev/null \
      || claude mcp remove total-recall 2>/dev/null \
      || true
  fi
  ok "Plugin-managed install — MCP server comes from the plugin's .mcp.json; skipping user-scope registration."
  note "MCP registration skipped (plugin-managed)."
else
  if claude mcp get total-recall >/dev/null 2>&1; then
    info "MCP server 'total-recall' already registered — removing for clean re-install."
    claude mcp remove total-recall -s user 2>/dev/null \
      || claude mcp remove total-recall 2>/dev/null \
      || true
    ok "Removed existing registration."
  fi
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
    # Capture `claude mcp get` output BEFORE grepping. This script runs under
    # `set -o pipefail` (line 78), and in the real failure case this guard is
    # meant to catch (wrong node path → stdio server unreachable) `claude mcp get`
    # prints "Failed to connect" AND exits non-zero. A bare `claude mcp get … |
    # grep -qi 'failed to connect'` pipeline then exits non-zero (pipefail takes
    # the rightmost non-zero stage = claude), the `if` is false, and the script
    # prints a FALSE `ok "Registered MCP server …"` while skipping the warning
    # that tells the user the node path is wrong — the guard could only ever fire
    # when claude exits 0 AND prints "Failed to connect", which is contradictory.
    # Capturing first (with `|| true` so a non-zero claude doesn't trip set -e
    # elsewhere) and grepping the captured string makes the match independent of
    # claude's exit status.
    MCP_GET_OUT=$(claude mcp get total-recall 2>&1 || true)
    if printf '%s' "$MCP_GET_OUT" | grep -qi 'failed to connect'; then
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
// String concat, not a template literal: `plugin` is $PLUGIN_ROOT from argv,
// and a backtick or `${` sequence in that path would break the template literal
// and abort the hook-wiring heredoc (silent: hooks never get wired). Plain
// concat is immune to path-content injection.
//
// #27: two corrections vs. the prior `'bash ' + plugin + ...` form:
//   1. Drop the `bash ` prefix. The hook scripts ship with
//      `#!/usr/bin/env bash` shebangs + exec bits, so direct invocation works
//      and matches the canonical hooks/hooks.json form (which invokes the
//      script path directly, no `bash ` wrapper).
//   2. Shell-quote the absolute path. Claude Code runs a hook `command` via
//      `sh -c "<command>"`, so an unquoted path containing spaces (e.g.
//      "/Users/My Name/plugins/total-recall") word-splits — `bash /Users/My`
//      was the command and `Name/plugins/.../x.sh` its (ignored) argument,
//      silently breaking every hook. Wrapping in single quotes (with embedded
//      single quotes escaped) makes the path one shell token regardless of
//      spaces.
//
// We CANNOT use hooks.json's `${CLAUDE_PLUGIN_ROOT}` here: --standalone wires
// into ~/.claude/settings.json OUTSIDE any plugin context, and that variable
// is plugin-manifest-only (it does not resolve in user settings.json — only
// ${CLAUDE_PROJECT_DIR} does, and we are not project-relative here). The
// literal absolute $PLUGIN_ROOT is the correct standalone equivalent; the
// only deliberate difference from hooks.json is variable-vs-literal, forced
// by the scope difference.
const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const cmd = (p, timeout) => ({ type: 'command', command: quote(plugin + '/hooks/scripts/' + p), timeout });
// Per-event presence check (REVIEW 5.1 / Phase 2.1). The old guard bailed on
// ANY total-recall hook via a single `includes('build-memory-index.sh')`,
// so a pre-5.1 standalone install (SessionStart/PostToolUse/PreCompact
// present, SessionEnd absent) re-running install.sh hit SKIP and never got
// the SessionEnd hook. Now each event is added only if its canonical
// total-recall script is absent — a re-run fills in the missing SessionEnd
// without duplicating the events already wired.
const has = (arr, script) => Array.isArray(arr) && arr.some(g =>
  Array.isArray(g.hooks) && g.hooks.some(h =>
    typeof h === 'object' && h !== null && typeof h.command === 'string' &&
    h.command.includes('/hooks/scripts/' + script)));
const added = [];
if (!has(s.hooks.SessionStart, 'build-memory-index.sh')) {
  (s.hooks.SessionStart = s.hooks.SessionStart || []).push({ hooks: [
    cmd('pull-org-vault.sh', 30),
    cmd('build-memory-index.sh', 15),   // must run BEFORE load-memory-index.sh
    cmd('load-memory-index.sh', 5),
    cmd('check-sync-errors.sh', 5),     // 4.4: warn if org-sync push failed since last success
  ] });
  added.push('SessionStart');
}
if (!has(s.hooks.PostToolUse, 'sync-org-memory.sh')) {
  (s.hooks.PostToolUse = s.hooks.PostToolUse || []).push({
    // Full MCP tool name is mcp__plugin_total-recall_total-recall__<tool>.
    // A bare "store_memory|update_memory|delete_memory" matcher contains only
    // exact-match chars (letters/digits/_/-/spaces/,/|), so Claude Code treats
    // it as an exact-string list and compares it against the full tool name →
    // never matches → the org-sync hook silently never fires. The parens below
    // force the regex path (unanchored), so it matches the __<tool> suffix.
    matcher: 'mcp__plugin_total-recall_total-recall__(store_memory|update_memory|delete_memory)',
    hooks: [ cmd('sync-org-memory.sh', 30) ],
  });
  added.push('PostToolUse');
}
if (!has(s.hooks.PreCompact, 'extract-and-store-memories.sh')) {
  (s.hooks.PreCompact = s.hooks.PreCompact || []).push({ hooks: [
    cmd('extract-and-store-memories.sh', 60),
  ] });
  added.push('PreCompact');
}
if (!has(s.hooks.SessionEnd, 'session-end.sh')) {
  (s.hooks.SessionEnd = s.hooks.SessionEnd || []).push({ hooks: [
    cmd('session-end.sh', 5),
  ] });
  added.push('SessionEnd');
}
if (added.length === 0) {
  console.log('SKIP: total-recall hooks already present.');
  process.exit(0);
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
console.log('WROTE: total-recall hooks added: ' + added.join(', ') + '.');
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
# Step 5c — Gemini CLI extension (optional, --gemini)
# --------------------------------------------------------------------------
step "Step 5c — Gemini CLI extension (optional)"
if [ "$GEMINI" -ne 1 ]; then
  ok "Gemini extension skipped. (Pass --gemini to install as a Gemini CLI extension.)"
elif ! command -v gemini >/dev/null 2>&1; then
  warn "'gemini' CLI not found on PATH — cannot install as an extension."
  warn "Install Gemini CLI first (https://github.com/google-gemini/gemini-cli), then re-run with --gemini."
  note "Gemini extension skipped (gemini CLI not on PATH)."
elif [ ! -f "$PLUGIN_ROOT/gemini-extension.json" ]; then
  warn "gemini-extension.json not found at $PLUGIN_ROOT/gemini-extension.json — skipping."
  note "Gemini extension skipped (manifest missing)."
elif [ ! -f "$PLUGIN_ROOT/hooks/hooks.gemini.json" ]; then
  warn "hooks/hooks.gemini.json not found at $PLUGIN_ROOT/hooks/hooks.gemini.json — skipping."
  note "Gemini extension skipped (hooks/hooks.gemini.json missing)."
else
  # The actual `gemini extensions install` command is INTERACTIVE: it prompts
  # "Do you trust the files in this folder?" even with --consent, and there
  # is no documented flag to bypass that prompt (the top-level `--skip-trust`
  # is a session flag, not an install subcommand flag). We can't pipe "y"
  # blindly — the prompt has a security policy reason. Instead, do the
  # automatable checks (idempotency) and print the exact command for the
  # user to run, with `--consent` so the SECOND prompt is auto-accepted.
  # Re-running the script is a no-op once the user has installed it.
  GEMINI_EXT_DIR="$HOME/.gemini/extensions/total-recall"
  if [ -d "$GEMINI_EXT_DIR" ] && [ -f "$GEMINI_EXT_DIR/gemini-extension.json" ]; then
    ok "Gemini extension already installed at $GEMINI_EXT_DIR"
    note "Gemini extension already installed."
  else
    info "Run the following command to install (it will ask you to trust the folder once):"
    info "  gemini extensions install --consent $PLUGIN_ROOT"
    # Try anyway, in case a future Gemini CLI version adds a non-interactive
    # flag. If it succeeds, great; if it hangs on the trust prompt, the user
    # will see the message above and can run the command themselves.
    if [ "$ASSUME_YES" -ne 1 ] && [ -t 0 ]; then
      # Interactive: try with consent; if it hangs the user can Ctrl-C and
      # the script will fall through to the manual command.
      if ( cd "$PLUGIN_ROOT" && gemini extensions install --consent "$PLUGIN_ROOT" 2>&1 ); then
        ok "Installed Gemini extension from $PLUGIN_ROOT"
        note "Gemini extension installed (run 'gemini' to start a session with 12 tools + hooks)."
      else
        warn "Install did not complete — run manually: gemini extensions install --consent $PLUGIN_ROOT"
        note "Gemini extension install did not complete (run manually)."
      fi
    else
      # Non-interactive: skip the attempt entirely. The user has the command.
      note "Gemini extension not yet installed — run: gemini extensions install --consent $PLUGIN_ROOT"
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
  EXISTING_REPO=""
  if [ -f "$CONFIG_FILE" ]; then
    EXISTING_REPO=$("$NODE_BIN" -e "try { const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')); console.log(c.orgRepo || ''); } catch { console.log(''); }")
  fi
  if [ -n "$EXISTING_REPO" ]; then
    ask_value "GitHub repo URL for the org vault (HTTPS, ending in .git)? [default: $EXISTING_REPO]" ORG_REPO
    [ -z "$ORG_REPO" ] && ORG_REPO="$EXISTING_REPO"
  else
    ask_value "GitHub repo URL for the org vault (HTTPS, ending in .git)?" ORG_REPO
  fi
  warn "The 'org-vault' branch must already exist with at least one commit."
  if [ -z "$ORG_DOMAIN" ]; then
    info "The privacy filter blocks all email addresses by default before pushing to GitHub."
    info "You can specify a domain (e.g., company.com) to allow work emails to bypass the filter."
    ask_value "Work email domain to allow in org-vault sync (blank = block all)?" ORG_DOMAIN
    [ -z "$ORG_DOMAIN" ] && ORG_DOMAIN_CLEARED=1
  fi
fi

if [ "$ENABLE_ORG" -eq 1 ] && [ -n "$ORG_REPO" ]; then
  node - "$CONFIG_FILE" "$ORG_REPO" "$ORG_DOMAIN" "$ORG_DOMAIN_CLEARED" <<'NODE'
const fs = require('fs');
const [, , cfgPath, repo, domain, clearDomain] = process.argv;
let c = {};
try { c = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) {}
c.orgRepo = repo;
if (domain) c.allowedEmailDomains = [domain];
else if (clearDomain === '1') delete c.allowedEmailDomains;
// otherwise preserve the existing allowedEmailDomains array (safe re-run)
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
step "Step 7 — Vector search"
if [ "$VECTOR" = "yes" ]; then
  # The local HuggingFace MiniLM embedder needs all three: sqlite-vec +
  # better-sqlite3 back the vector store, @huggingface/transformers serves the
  # in-process embeddings. There is no external daemon, so there is no provider
  # branch — every Complete install pulls the same dep set.
  VEC_DEPS="@huggingface/transformers sqlite-vec better-sqlite3"
  info "Installing vector-search dependencies (local HuggingFace MiniLM) in $PLUGIN_ROOT ..."
  # --no-save: these deps are ALREADY declared in package.json `optionalDependencies`
  # (so the bundle externalizes them and the plugin loads without them). A bare
  # `npm install <pkg>` (npm 7+) defaults to --save, which would duplicate them into
  # `dependencies` — and if the maintainer ever committed that locally-mutated
  # package.json, consumers' `claude plugin update` would treat them as required,
  # defeating graceful degradation. --no-save installs into node_modules only,
  # leaving package.json untouched.
  # shellcheck disable=SC2086  # VEC_DEPS is an intentional word-split list
  if ( cd "$PLUGIN_ROOT" && npm install --no-save $VEC_DEPS && npm run build ); then
    # Verify the better-sqlite3 native binding actually loads. npm install runs
    # prebuild-install as better-sqlite3's postinstall, but a source-only dir
    # (e.g. a `claude plugin update` landing without a matching prebuild, or a
    # musl/glibc mismatch) leaves the .node file absent — `require()` throws.
    # The runtime getDb() self-heal + honest "still missing" error in
    # vectorStore.ts is the backstop; this install-time check catches it now and
    # attempts a node-gyp rebuild before deferring to the backstop.
    if ( cd "$PLUGIN_ROOT" && node -e "require('better-sqlite3')" ) 2>/dev/null; then
      ok "Vector search enabled (TF-IDF + local HuggingFace embeddings via RRF)."
      note "Vector search enabled (local HuggingFace embeddings)."
    else
      warn "better-sqlite3 native binding missing — attempting node-gyp rebuild ..."
      if [ -d "$PLUGIN_ROOT/node_modules/better-sqlite3" ] && \
         ( cd "$PLUGIN_ROOT/node_modules/better-sqlite3" && npx --no-install node-gyp rebuild ) 2>/dev/null && \
         ( cd "$PLUGIN_ROOT" && node -e "require('better-sqlite3')" ) 2>/dev/null; then
        ok "Vector search enabled (native binding rebuilt via node-gyp)."
        note "Vector search enabled (local HuggingFace embeddings)."
      else
        warn "better-sqlite3 native binding still missing — plugin will run TF-IDF only (getDb self-heals on next start)."
        note "Vector search unavailable — native binding missing."
      fi
    fi
  else
    warn "npm install/build failed — plugin will fall back to TF-IDF only."
  fi
else
  ok "Vector search skipped. Plugin uses TF-IDF + Ebbinghaus decay only."
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
