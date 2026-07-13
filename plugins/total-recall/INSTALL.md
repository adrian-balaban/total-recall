# 📦 Installing Total Recall

One plugin, four clients — Claude Code, GitHub Copilot CLI, Gemini CLI, and standalone — all set up by a single state-aware `install.sh`.

## Prerequisites

- **Node.js v18+** on PATH
- `claude` CLI (for MCP registration; skipped with a warning if absent)
- `gh` CLI authenticated — **only** if you enable the shared org vault
- `gemini` / `copilot` CLI — **only** for `--gemini` / `--copilot`

## Install profiles

On start, `install.sh` asks which profile you want (skip the prompt with a flag). **Complete is the default** — pressing Enter, `-y`, or a non-interactive run all select it:

| Profile | Flag | What you get |
|---|---|---|
| **a. Minimal** | `--default` | No optional dependencies, no local LLM. TF-IDF + Ebbinghaus search only. Smallest footprint, works air-gapped. |
| **b. Complete** (default) | `--complete` | Hybrid vector search. The embedding provider is auto-detected: if `ollama` is on PATH **and** `ollama list` shows the `bge-m3` model, embeddings come from Ollama (no model download); otherwise a local HuggingFace MiniLM via `@huggingface/transformers` (~200 MB downloaded on first use). `sqlite-vec` is installed either way. |

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
./install.sh --standalone
```

`install.sh` is **safe to re-run** — every step checks current state first. What it does:

1. Detect plugin path (`--plugin-root` → `$CLAUDE_PLUGIN_ROOT` → its own dir → `claude mcp get` → prompt)
2. Create vault directories under `~/.total-recall/`
3. Register the MCP server (`claude mcp add-json`, user scope)
4. Build the initial index
5. Wire hooks (`--standalone` only), optional statusline (`--statusline`), Gemini (`--gemini`), Copilot (`--copilot`)
6. Org vault (optional — `--org-repo URL`, `--allowed-email-domain D`)
7. Vector search (per the chosen profile)
8. Verify + summary

Run `./install.sh --help` for every flag (`-y` for non-interactive defaults).

## Windows

Run `install.sh` from **Git Bash** (ships with [Git for Windows](https://gitforwindows.org/)). Claude Code on Windows also executes the plugin's lifecycle hooks through Git Bash, so having it installed covers both.

Notes:

- Use a **Windows Node.js** (`node.exe` on PATH). Node installed only inside WSL is not visible to Git Bash/Claude Code.
- `flock` is not available in Git Bash — org-sync coalescing degrades gracefully to one sync per write (handled inside `sync-org-memory.sh`; you'll see a note in `~/.total-recall/org/.sync.log`).
- Memory keys and git pathspecs are normalized to `/` separators internally, so vaults created on Windows are fully interchangeable with Linux/macOS vaults (including the shared org vault).

## Codex CLI (MCP only, no hooks)

Register the stdio server in `~/.codex/config.toml`:

```toml
[mcp_servers.total-recall]
command = "node"
args = ["/absolute/path/to/plugins/total-recall/dist/index.js"]
```

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

## Verify

Start a new session; the memory index should be injected automatically (Claude Code). Or ask: *"what do you remember about …"* → the model calls `recall_memory`. `get_stats` shows totals, cache stats, and recent errors.
