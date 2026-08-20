# 📦 Installing Total Recall

One plugin, two clients — Claude Code and Gemini CLI — all set up by a single state-aware `install.sh`.

## 📋 Prerequisites

- **Node.js v18+** on PATH
- `claude` CLI (for MCP registration; skipped with a warning if absent)
- `gh` CLI authenticated — **only** if you enable the shared org vault
- `agy` CLI — **only** for `--gemini`
- **Git Bash** — **only** on Windows, to run `install.sh` (see [Windows](#windows))

## 🪟 Windows

Run `install.sh` from **Git Bash** (ships with [Git for Windows](https://gitforwindows.org/)). Claude Code on Windows also executes the plugin's lifecycle hooks through Git Bash, so having it installed covers both.

Use a **Windows Node.js** (`node.exe` on PATH). Node installed only inside WSL is not visible to Git Bash/Claude Code.

## 🎚️ Install profiles

On start, `install.sh` asks which profile you want (skip the prompt with a flag). **Complete is the default** — pressing Enter, `-y`, or a non-interactive run all select it:

| Profile | Flag | What you get |
|---|---|---|
| **a. Minimal** | `--no-vector` | No optional dependencies, no local LLM. TF-IDF + Ebbinghaus search only. Smallest footprint, works air-gapped. |
| **b. Complete** (default) | `--complete` (aliases `--vector`, `--default`) | Hybrid vector search. Embeddings come from a local in-process HuggingFace MiniLM via `@huggingface/transformers` (~200 MB downloaded on first use), backed by `sqlite-vec` + `better-sqlite3`. No external service or daemon to run. |

Either profile can later be upgraded/downgraded — vector search degrades gracefully to TF-IDF when its optional dependencies are missing.

## ⚡ Install (marketplace)

The plugin is distributed **only through the marketplace**. From inside a Claude Code session:

```
/plugin marketplace add adrian-balaban/total-recall
/plugin install total-recall
```

or from the shell:

```bash
claude plugin marketplace add adrian-balaban/total-recall
claude plugin install total-recall
```

Then run the setup script once, from the installed plugin directory, to create the vaults, register the MCP server, and build the index:

```bash
./install.sh
```

Hooks need no wiring — they auto-load from the plugin manifest's `hooks/hooks.json`.

**What you are installing.** The marketplace fetches the **`release` branch**, whose `dist/` bundle is built by GitHub Actions after the CI gate (dependency audit, typecheck, build, mutation testing) goes green. `dist/` is gitignored on `main`, so no hand-built artifact can reach you. There is deliberately no zip download and no npm package — one channel, one thing to trust.

### Gemini CLI

```bash
./install.sh --gemini    # MCP + hooks/hooks.gemini.json (requires the `agy` CLI)
```

### Developing from a clone

Only for working on the plugin — not a supported install path for users:

```bash
git clone https://github.com/adrian-balaban/total-recall.git
cd total-recall/plugins/total-recall
npm install && npm run build   # dist/ is gitignored, so a clone has none
claude plugin install "$(pwd)"
```

`./install.sh` also builds `dist/` for you when it is missing.

If you only want the MCP server registered (no hooks, e.g. to inspect/manage it) without going through the plugin flow, use `/mcp`:

```
/mcp add total-recall -- node /absolute/path/to/plugins/total-recall/dist/index.js
```

`/mcp` also lists and can remove already-registered servers — useful for checking that `install.sh` registered `total-recall` correctly (equivalent to `claude mcp get total-recall` from the shell).

`install.sh` is **safe to re-run** — every step checks current state first. What it does:

1. Detect plugin path (`--plugin-root` → `$CLAUDE_PLUGIN_ROOT` → its own dir → `claude mcp get` → prompt), identified by the tracked `.claude-plugin/plugin.json`; **builds `dist/` if it is absent** (`npm ci && npm run build`, needed for a clone of `main`); prints the resolved plugin version and warns when it resolved into the Claude plugin cache (which lags until `claude plugin update`)
2. Create vault directories under `~/.total-recall/` (and one-time local-only `git init` of the personal vault for durability snapshots)
3. Register the MCP server (`claude mcp add-json`, user scope) — skipped (and any stale user-scope duplicate removed) when total-recall is already plugin-managed
4. Build the initial index
5. Hooks — auto-load from `hooks/hooks.json` (no wiring step); optional statusline (`--statusline`), Gemini (`--gemini`)
6. Org vault (optional — `--org-repo URL`, `--allowed-email-domain D`)
7. Vector search (per the chosen profile)
8. Verify + summary

Run `./install.sh --help` for every flag (`-y` for non-interactive defaults).

## 👥 Org vault (team memory)

```bash
./install.sh --org-repo https://github.com/your-org/team-vault.git \
             --allowed-email-domain yourcompany.com
```

Requirements: `gh auth status` green, and the org-sync branch (`orgBranch` in `~/.total-recall/config.json`, default `org-vault`) must already exist on the repo with at least one commit. Memories tagged `org` then sync automatically through the fail-closed privacy filter.

## 🔐 Privacy model — what is blocked, what is only warned

Two layers, with different threat models:

- **Org vault (shared repo) — hard block.** The org-sync hook runs a fail-closed privacy filter *before* `git add`: it refuses to push any memory containing a secret token / API key (known-prefix `sk-`, `ghp_`, `AKIA`…, PEM headers; labeled-generic `api_key:` / `Authorization: Bearer` / `password =` forms; high-entropy mixed-class blobs), a credit card (Luhn-validated), an IBAN (ISO 13616 mod-97-validated), a formatted phone number, or a personal email outside your `--allowed-email-domain`. Nothing in those categories ever reaches the shared repo.
- **Personal vault (local, in the clear) — non-blocking warning only.** The personal vault stores content verbatim and is local to your machine (the embedder runs in-process; nothing leaves the host), so a secret stored there is not a *remote* leak — but it IS sitting on disk in the clear. `store_memory` writes a one-line stderr warning when the body looks like a known-prefix secret token (`sk-…`, `ghp_…`, `AKIA…`, PEM headers). It does **not** block the store — the broader labeled-generic / high-entropy / financial / email detectors are intentionally NOT applied to the personal vault, to keep the personal-vault false-positive rate near zero (a noisy warning you learn to ignore is worse than no warning). If you need a hard guarantee a secret never touches disk, do not store it in any vault — the personal vault is not encrypted.


## 🧭 Enabling vector search later

```bash
cd plugins/total-recall
npm install --no-save @huggingface/transformers sqlite-vec better-sqlite3
npm run build
```

(`npm run build` here rebuilds your local `dist/`, which is gitignored — it changes only your working copy.)

Or just re-run `./install.sh --complete`.

## 🤖 Codex CLI (MCP only, no hooks)

Codex CLI speaks MCP but does **not** run Claude Code lifecycle hooks, so the SessionStart memory-index injection, PostToolUse org-vault sync, and PreCompact journal extraction do not fire. You get the 17 MCP tools (read/write/search via `recall_memory`, `search_index`, `store_memory`, …) but no automatic capture or proactive injection — call the tools explicitly.

To wire it, point Codex at the plugin's MCP server (the compiled `dist/index.js`); hooks are simply ignored. Memory is fully usable on demand; only the auto-capture hooks are absent.

## ✅ Verify

Start a new session; the memory index should be injected automatically (Claude Code). Or ask: *"what do you remember about …"* → the model calls `recall_memory`. `get_stats` shows totals, cache stats, and recent errors.

### `get_stats` says vector search is off after `claude plugin update`

A fresh `claude plugin update` creates a new version dir under `~/.claude/plugins/cache/.../<VERSION>/` and does **not** re-run `install.sh`, so the `better-sqlite3` native binding can be left source-only (no `build/Release/better_sqlite3.node`). When that happens `get_stats` reports `vector.depsPresent: false` / `vector.enabled: false` — the one honest "disabled" state. The in-process self-heal in `vectorStore.ts` tries `npm rebuild better-sqlite3` once on first load; if it still shows false, run it manually in that version dir:

```bash
cd ~/.claude/plugins/cache/anthropic.com/total-recall/<VERSION>/total-recall/plugins/total-recall
npm rebuild better-sqlite3
```

(With deps properly installed, `get_stats` reports `vector.enabled: true` from a fresh session — vector search defaults to on.)
