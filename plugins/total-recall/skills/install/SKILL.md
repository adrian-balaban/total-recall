---
name: install
description: This skill should be used when the user asks to "install total-recall", "set up total-recall", "initialize total-recall for the first time", "configure the MCP server", "wire up hooks manually" or asks about "what's configurable" in total-recall. Covers first-run initialization (vault dirs, MCP registration, index build, org vault, vector search) and standalone manual hook wiring, migration notes, and known gotchas.
---

# Total Recall — Complete Install & Setup

This skill covers everything needed to get Total Recall running: first-run initialization for plugin installs, standalone manual hook wiring, and known gotchas. Each step checks current state before acting — safe to re-run on a partially set-up installation.

## What Is Configurable

The vault location is **fixed** at `~/.total-recall` (`personal-vault/` and `org/org-vault/`). The optional config file is `~/.total-recall/config.json`. Configurable:

- Whether the **shared org vault** is enabled (cloned from GitHub, branch `org-vault`) — set `orgRepo` in `config.json`
- Org-vault email allow-list — set `allowedEmailDomains` in `config.json`; default blocks all emails (fail-closed)
- **MCP server** registration
- **Hooks** (SessionStart / PostToolUse / PreCompact) — auto-loaded for plugin installs; manual wiring for standalone only
- **Optional vector search** (hybrid TF-IDF + embeddings via HuggingFace)

## Prerequisites

- Node.js v18+ (per `package.json` `engines`)
- `gh` CLI authenticated (`gh auth status`) — required for org vault GitHub sync (token scopes: `repo` read + write)

---

## Step 1 — Detect Plugin Path

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT=$(claude mcp get total-recall 2>/dev/null | grep -o '"[^"]*dist/index.js"' | sed 's|/dist/index.js"||;s|^"||')
fi
```

If `PLUGIN_ROOT` is still empty, ask the user: "What is the path to the total-recall plugin directory?"

## Step 2 — Create Vault Directories

```bash
mkdir -p ~/.total-recall/personal-vault/{architecture,decisions,troubleshooting,meetings,knowledge,journal}
mkdir -p ~/.total-recall/org
```

If `~/.total-recall/personal-vault` already exists and is non-empty, skip and say "Vault directories already exist."

## Step 3 — Register MCP Server

Check if already registered:
```bash
claude mcp get total-recall 2>/dev/null
```

If not registered:
```bash
NODE=$(~/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1 || which node)
claude mcp add-json total-recall "{\"type\":\"stdio\",\"command\":\"$NODE\",\"args\":[\"$PLUGIN_ROOT/dist/index.js\"]}" --scope user
```

Verify with `claude mcp get total-recall` — if it shows "Failed to connect", the node path is wrong. Show the user the path used and ask them to confirm or correct it.

## Step 4 — Build Initial Index

```bash
bash "$PLUGIN_ROOT/hooks/scripts/build-memory-index.sh"
```

## Step 5 — Hook Wiring (Standalone Only)

**Plugin installs skip this step entirely** — `hooks/hooks.json` is auto-loaded when installed via `claude plugin install`.

For standalone MCP setups only, manually wire hooks in `~/.claude/settings.json`. See **`references/hook-wiring.md`** for the complete hooks JSON template with all four SessionStart commands, the PostToolUse matcher, and the PreCompact script.

Key constraint: `build-memory-index.sh` must run **before** `load-memory-index.sh` on each SessionStart.

## Step 6 — Org Vault (Optional)

Ask: "Do you want to enable the shared org vault for syncing `org`-tagged memories to GitHub?"

If **yes**:
1. Ask: "GitHub repo URL for the org vault?" (full HTTPS URL ending in `.git`)
2. Ask: "Branch name?" (default: `org-vault`) — remind the user this branch must already exist with at least one commit
3. Ask (optional): "Any work email domain to allow in org-vault sync? The privacy filter blocks ALL emails by default. Leave blank to keep the safe default." If they give one (e.g. `yourcompany.com`), include `allowedEmailDomains`.
4. Write config:

```bash
# Without email domain:
echo '{"orgRepo":"<URL>"}' > ~/.total-recall/config.json

# With email domain:
echo '{"orgRepo":"<URL>","allowedEmailDomains":["<domain>"]}' > ~/.total-recall/config.json
```

5. Clone vault:
```bash
bash "$PLUGIN_ROOT/hooks/scripts/pull-org-vault.sh"
```

If clone fails, show the error and suggest: check that the branch exists (`git ls-remote <URL> <branch>`), and that `gh auth status` shows the correct account.

If **no**: say "Org vault skipped. Enable later by setting `orgRepo` in `~/.total-recall/config.json`."

## Step 7 — Vector Search (Optional)

Ask: "Do you want to enable hybrid vector search (TF-IDF + embeddings via HuggingFace)? Requires ~200 MB download on first use."

If **yes**:
```bash
cd "$PLUGIN_ROOT"
npm install @huggingface/transformers sqlite-vec better-sqlite3
npm run build
```

If **no**: say "Vector search skipped. Plugin uses TF-IDF + Ebbinghaus decay by default."

## Step 8 — Verify

```bash
ls "$PLUGIN_ROOT/dist/index.js" && claude mcp get total-recall
```

Summarize what was set up, what was skipped, and any manual steps still needed.

---

## Known Gotchas

- **`node` not on PATH**: `claude mcp add-json` must use the full path to the node binary (e.g. `~/.nvm/versions/node/v24.15.0/bin/node`), otherwise MCP server shows "Failed to connect"
- **`org-vault` branch must pre-exist**: `pull-org-vault.sh` clones the branch but won't create it — initialize with at least one commit before first session start
- **YAML array format**: Memory tags must be in inline array format `[tag1, tag2]` on a single line — multi-line YAML sequences are not supported by the sync script's lightweight parser
- **Org tag**: tag memories with `org` to route to the shared org vault and trigger sync
- **Hook output format**: All hooks must output valid JSON `{"continue":true,...}` — any non-JSON output or non-zero exit causes the hook to fail silently; see `references/hook-wiring.md` for details

---

## Additional Resources

- **`references/hook-wiring.md`** — Complete hooks JSON template for standalone manual wiring, output format requirements
