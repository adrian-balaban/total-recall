# 📦 Installing Total Recall

One plugin, four clients — Claude Code, GitHub Copilot CLI, Gemini CLI, and standalone — all set up by a single state-aware `install.sh`.

## Prerequisites

- **Node.js v18+** on PATH
- `claude` CLI (for MCP registration; skipped with a warning if absent)
- `gh` CLI authenticated — **only** if you enable the shared org vault
- `gemini` / `copilot` CLI — **only** for `--gemini` / `--copilot`
- **Git Bash** — **only** on Windows, to run `install.sh` (see [Windows](#windows))

## Windows

Run `install.sh` from **Git Bash** (ships with [Git for Windows](https://gitforwindows.org/)). Claude Code on Windows also executes the plugin's lifecycle hooks through Git Bash, so having it installed covers both.

Use a **Windows Node.js** (`node.exe` on PATH). Node installed only inside WSL is not visible to Git Bash/Claude Code.

## Install profiles

On start, `install.sh` asks which profile you want (skip the prompt with a flag). **Complete is the default** — pressing Enter, `-y`, or a non-interactive run all select it:

| Profile | Flag | What you get |
|---|---|---|
| **a. Minimal** | `--default` (alias `--no-vector`) | No optional dependencies, no local LLM. TF-IDF + Ebbinghaus search only. Smallest footprint, works air-gapped. |
| **b. Complete** (default) | `--complete` (alias `--vector`) | Hybrid vector search. The embedding provider is auto-detected: if `ollama` is on PATH **and** `ollama list` shows the `bge-m3` model, embeddings come from Ollama (no model download); otherwise a local HuggingFace MiniLM via `@huggingface/transformers` (~200 MB downloaded on first use). `sqlite-vec` is installed either way (regardless of which embedding provider is used). |

The detected provider only seeds `embeddingProvider` in `~/.total-recall/config.json` when it is unset — an explicit value there is never overwritten on re-run. Either profile can later be upgraded/downgraded — vector search degrades gracefully to TF-IDF when its optional dependencies are missing.

## Quick install by client

```bash
# 1. Clone and build
git clone https://github.com/adrian-balaban/my-claude-plugins-marketplace.git
cd my-claude-plugins-marketplace/plugins/total-recall
npm install && npm run build

# 2. Register for your client:

# Claude Code (native — hooks auto-load from hooks/hooks.json)
claude plugin install "$(pwd)"

# GitHub Copilot CLI (MCP + hooks/hooks.copilot.json)
./install.sh --copilot

# Gemini CLI (MCP + hooks/hooks.gemini.json)
./install.sh --gemini

# Standalone (writes absolute hook paths into ~/.claude/settings.json)
# Refuses (with a confirm prompt) if total-recall is already installed via the
# plugin manager — running both would start two MCP servers and inject the
# memory index twice per session. Pick one mode.
./install.sh --standalone
```

### From inside a Claude Code session

Instead of running `claude plugin install` from the shell, you can add and install it interactively with slash commands:

```
/plugin marketplace add adrian-balaban/my-claude-plugins-marketplace
/plugin install total-recall
```

This is equivalent to `claude plugin install "$(pwd)"` above but doesn't require a local clone — Claude Code fetches the marketplace and plugin directly. Hooks still auto-load from `hooks/hooks.json`.

If you only want the MCP server registered (no hooks, e.g. to inspect/manage it) without going through the plugin flow, use `/mcp`:

```
/mcp add total-recall -- node /absolute/path/to/plugins/total-recall/dist/index.js
```

`/mcp` also lists and can remove already-registered servers — useful for checking that `install.sh` registered `total-recall` correctly (equivalent to `claude mcp get total-recall` from the shell).

`install.sh` is **safe to re-run** — every step checks current state first. What it does:

1. Detect plugin path (`--plugin-root` → `$CLAUDE_PLUGIN_ROOT` → its own dir → `claude mcp get` → prompt); prints the resolved plugin version and warns when it resolved into the Claude plugin cache (which lags the repo until `claude plugin update`) or when `--standalone` would duplicate an existing plugin-manager install
2. Create vault directories under `~/.total-recall/`
3. Register the MCP server (`claude mcp add-json`, user scope) — skipped (and any stale user-scope duplicate removed) when total-recall is already plugin-managed and `--standalone` wasn't requested
4. Build the initial index
5. Wire hooks (`--standalone` only), optional statusline (`--statusline`), Gemini (`--gemini`), Copilot (`--copilot`)
6. Org vault (optional — `--org-repo URL`, `--allowed-email-domain D`)
7. Vector search (per the chosen profile)
8. Verify + summary

Run `./install.sh --help` for every flag (`-y` for non-interactive defaults).

## Org vault (team memory)

```bash
./install.sh --org-repo https://github.com/your-org/team-vault.git \
             --allowed-email-domain yourcompany.com
```

Requirements: `gh auth status` green, and the `org-vault` branch must already exist on the repo with at least one commit. Memories tagged `org` then sync automatically through the fail-closed privacy filter.

## Enabling vector search later

```bash
cd plugins/total-recall
npm install --no-save @huggingface/transformers sqlite-vec better-sqlite3
npm run build
```

Or just re-run `./install.sh --complete`.

## Codex CLI (MCP only, no hooks)

Codex CLI speaks MCP but does **not** run Claude Code lifecycle hooks, so the SessionStart memory-index injection, PostToolUse org-vault sync, and PreCompact journal extraction do not fire. You get the 17 MCP tools (read/write/search via `recall_memory`, `search_index`, `store_memory`, …) but no automatic capture or proactive injection — call the tools explicitly.

To wire it, point Codex at the plugin's MCP server (the compiled `dist/index.js`); hooks are simply ignored. Memory is fully usable on demand; only the auto-capture hooks are absent.

## Verify

Start a new session; the memory index should be injected automatically (Claude Code). Or ask: *"what do you remember about …"* → the model calls `recall_memory`. `get_stats` shows totals, cache stats, and recent errors.
