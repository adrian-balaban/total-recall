# 📦 Installing Total Recall

One plugin for Claude Code, Gemini/Antigravity, VS Code (GitHub Copilot agent mode) and any other MCP client (Codex CLI, Cursor, Windsurf, Claude Desktop), set up by a single state-aware `install.sh`.

## 📋 Prerequisites

- **Node.js v18+** on PATH
- `git`
- `claude` CLI — for Claude Code: MCP registration and automatic capture before compaction (skipped with a warning if absent). Optional for Gemini/Antigravity, where it is used only for automatic capture. The Claude Code VS Code extension ships its own `claude` binary under its extension directory, which is not on `PATH`; if `install.sh` reports the CLI as missing on such a machine, MCP registration is the only step skipped — the plugin and its hooks still load.
- `gh` CLI authenticated — **only** for a shared org vault on GitHub (other hosts need git credentials that work without a prompt)
- `agy` CLI — **required** for Gemini/Antigravity (`--gemini` installs the extension with it)
- **Git Bash** — **only** on Windows, to run `install.sh` (see [Windows](#-windows))

## 🪟 Windows

Run `install.sh` from **Git Bash** (ships with [Git for Windows](https://gitforwindows.org/)). Claude Code on Windows also executes the plugin's lifecycle hooks through Git Bash, so having it installed covers both.

Use a **Windows Node.js** (`node.exe` on PATH). Node installed only inside WSL is not visible to Git Bash/Claude Code.

- **Every shell step in these docs** (`install.sh`, the `bash "$(ls -d …)"` command, `bash hooks/scripts/pull-org-vault.sh`) runs in Git Bash, not PowerShell or cmd.
- **`~`** is `C:\Users\<you>`: the vaults live in `C:\Users\<you>\.total-recall\`.
- **MCP configs for other clients** use `bash` as the command and the script path as the argument; if `bash` is not on the client's `PATH`, give the full path: `"command": "C:\\Program Files\\Git\\bin\\bash.exe"`.
- **`--vscode`** writes `%APPDATA%\Code\User\mcp.json` and a `bash` entry (fixed in 1.6.9; see issues #36–#38).
- **Vector search** needs a `better-sqlite3` binary. If no prebuilt one matches your Node version, npm compiles it, which needs the Visual Studio Build Tools; without it, search stays text-only.
- **Not tested on a real Windows machine.** The Windows steps follow the code and Git for Windows behaviour but no end-to-end install on Windows has been run by the maintainer. Reports are welcome.

## 🎚️ Install profiles

On start, `install.sh` asks which profile you want (skip the prompt with a flag). **Complete is the default** — pressing Enter, `-y`, or a non-interactive run all select it:

| Profile | Flag | What you get |
|---|---|---|
| **a. Minimal** | `--no-vector` | No optional dependencies, no local LLM. TF-IDF + Ebbinghaus search only. Smallest footprint, works air-gapped. |
| **b. Complete** (default) | `--complete` (aliases `--vector`, `--default`) | Hybrid vector search. Embeddings come from a local in-process multilingual MiniLM (`Xenova/paraphrase-multilingual-MiniLM-L12-v2`, 50+ languages) via `@huggingface/transformers` (~450 MB downloaded on first use), backed by `sqlite-vec` + `better-sqlite3`. No external service or daemon to run. |

Either profile can later be upgraded/downgraded — vector search degrades gracefully to TF-IDF when its optional dependencies are missing.

## ⚡ Install (marketplace)

Claude Code installs from the marketplace. Use the full ID: other plugins are also called `total-recall`. From inside a Claude Code session:

```
/plugin marketplace add adrian-balaban/total-recall
/plugin install total-recall@my-claude-plugins
```

or from the shell:

```bash
claude plugin marketplace add adrian-balaban/total-recall
claude plugin install total-recall@my-claude-plugins
```

Then run the setup script once, from the installed plugin directory (`~/.claude/plugins/cache/my-claude-plugins/total-recall/<VERSION>/`), to create the vaults, register the MCP server, and build the index:

```bash
bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
```

Hooks need no wiring — they auto-load from the plugin manifest's `hooks/hooks.json`.

**One command (npx).** `npx @adrian-balaban/total-recall [install.sh flags]` runs `claude plugin marketplace add adrian-balaban/total-recall`, then `claude plugin install total-recall@my-claude-plugins`, then the `install.sh` of the newest cached version. It is safe to re-run, skips the first two steps when the plugin is already installed, finds the `claude` binary bundled with the VS Code extension when it is not on `PATH`, and stops when another plugin named `total-recall` is installed (`--force` overrides). On Windows it needs Git Bash and exits with code 69 without it. Always use the scoped name: the unscoped `total-recall` on npm is an unrelated tool. To check what the package contains: `npm pack --dry-run @adrian-balaban/total-recall` lists the launcher, `package.json`, README and LICENSE.

**What you are installing.** The marketplace fetches the **`release` branch**, whose `dist/` bundle is built by GitHub Actions after the CI gate (dependency audit, typecheck, build, mutation testing) goes green. `dist/` is gitignored on `main`, so no hand-built artifact is committed there. There is deliberately no zip download, and the only npm package is the install launcher described below, which contains no plugin code — one channel for the code, built by CI. Nothing is signed yet (commits, tags and the bundle), so what you trust is this repository and GitHub Actions.

## 🧩 Install without Claude Code

Every other assistant uses the same files from the `release` branch, which CI builds after the gate passes (the marketplace installs the same branch):

```bash
git clone --depth 1 -b release https://github.com/adrian-balaban/total-recall.git ~/total-recall-plugin
cd ~/total-recall-plugin/plugins/total-recall
./install.sh -y            # add --gemini or --vscode to register the server for those hosts
```

Without the `claude` CLI, `install.sh` skips MCP registration with a warning and does the rest. Register the server in your assistant's MCP configuration (command `bash`, argument the absolute path of `scripts/start-server.sh`) and add the memory instructions to its instruction file (the `## Memory` block from the README's [Quick start, step 3](../../README.md#claude-code)). Host-specific notes follow below: [Gemini/Antigravity](#geminiantigravity), [VS Code](#vs-code-copilot-agent-mode--manual-mcpjson), [Codex CLI](#-codex-cli-mcp-only-no-hooks). To upgrade: `git fetch && git reset --hard origin/release` in the clone (the branch is rebuilt by CI, so `git pull` can fail), then re-run `./install.sh -y`. To uninstall: remove the `total-recall` entry from your assistant's MCP configuration and delete the clone (`~/total-recall-plugin`); your memories stay in `~/.total-recall/` until you delete that folder.

### Gemini/Antigravity

```bash
./install.sh --gemini    # MCP + hooks/hooks.gemini.json (requires the `agy` CLI)
```

### VS Code (Copilot agent mode) — manual `mcp.json`

Only needed when VS Code agent plugins are off (with them on, the plugin's own `.mcp.json` and hooks should load; not yet verified end to end).

```bash
./install.sh --vscode    # adds total-recall to VS Code's user mcp.json (tools only; no hooks)
```

The entry runs `bash` with the absolute path of `scripts/start-server.sh`, which finds `node` even when VS Code was launched without it on `PATH`. For team sync without hooks, set `"orgSync": "server"` (see [Org vault](#-org-vault-team-memory)). Existing servers in the file are kept; a file with comments is left untouched and the snippet is printed instead. Without hooks the model reads the memory index from the `total-recall://index` resource and the `memory-workflow` prompt. The same command prints a snippet for Visual Studio's `.mcp.json` (not yet verified on a real install).

### Developing from a clone

Only for working on the plugin. Users without Claude Code should clone the `release` branch instead (see above), which has `dist/` prebuilt:

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

`/mcp` also lists and can remove already-registered servers — useful for checking that `install.sh` registered `total-recall` correctly (equivalent to `claude mcp get total-recall` from the shell, or `claude mcp get plugin:total-recall:total-recall` when the plugin came from the marketplace).

`install.sh` is **safe to re-run** — every step checks current state first. What it does:

1. Detect plugin path (`--plugin-root` → `$CLAUDE_PLUGIN_ROOT` → its own dir → `claude mcp get` → prompt), identified by the tracked `.claude-plugin/plugin.json`; **builds `dist/` if it is absent** (`npm ci && npm run build`, needed for a clone of `main`); prints the resolved plugin version and warns when it resolved into the Claude plugin cache (which lags until `claude plugin update`)
2. Create vault directories under `~/.total-recall/` (and one-time local-only `git init` of the personal vault for durability snapshots, with `vectors.db*` git-ignored as derived data; SessionEnd only commits to a repo that already exists, so re-run `./install.sh` if your vault has no `.git`)
3. Register the MCP server (`claude mcp add-json`, user scope) — skipped (and any stale user-scope duplicate removed) when total-recall is already plugin-managed
4. Build the initial index
5. Hooks — auto-load from `hooks/hooks.json` (no wiring step); optional statusline (`--statusline`), Gemini/Antigravity (`--gemini`), VS Code MCP entry (`--vscode`)
6. Org vault (optional — `--org-repo URL`, `--allowed-email-domain D`)
7. Vector search (per the chosen profile)
8. Verify + summary

Run `./install.sh --help` for every flag (`-y` for non-interactive defaults).

## 👥 Org vault (team memory)

```bash
./install.sh --org-repo https://github.com/your-org/team-vault.git \
             --allowed-email-domain yourcompany.com
```

`--org-repo` takes a repo on **any** git host — pass an `https://` URL (typically ending in `.git`) or a `git@` SSH URL. `gh` is used for authentication when the host is GitHub and falls back to plain `git` otherwise, so GitLab, Bitbucket and self-hosted remotes work the same way (see the requirements note below).

**Team setup, step by step**

1. Create a private Git repo on any host (GitHub, GitLab, Bitbucket, your own) with a branch named `knowledge` that has at least one commit. Don't require pull requests on that branch: sync pushes to it directly.

   ```bash
   git clone https://github.com/your-org/team-vault.git && cd team-vault
   git switch -c knowledge && git commit --allow-empty -m "init" && git push -u origin knowledge
   ```

2. Each teammate re-runs the setup script from the README's [Quick start, step 2](../../README.md#claude-code) with the repo (for GitHub, `gh auth login` first; for other hosts, git credentials that work without a prompt, such as a credential helper or an SSH key). `--allowed-email-domain` lets your work email domain through the privacy filter:

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh" --org-repo https://github.com/your-org/team-vault.git --allowed-email-domain yourcompany.com
   ```

3. From then on, in Claude Code and Gemini/Antigravity, a memory tagged `org` is pushed after it is stored, and each session pulls teammates' memories at start. Other assistants have no hooks for this: see the notes below.

4. Check it: on one machine say *"remember for the team that …"*; on another, start a new session and ask about it. If it does not arrive, ask for `get_stats` (recent errors); in Claude Code the session start also warns when team pushes keep failing.

Requirements: for GitHub, `gh auth status` green (the scripts use `gh` when it is available and fall back to plain `git`, with prompts disabled, so other hosts need credentials that work without a prompt, such as a credential helper or an SSH key), and the org-sync branch (`orgBranch` in `~/.total-recall/config.json`, default `knowledge`) must already exist on the repo with at least one commit. Memories tagged `org` then sync automatically through the fail-closed privacy filter.

Assistants without hooks (Codex, Cursor, Windsurf, Claude Desktop, Visual Studio) do not pull or push on their own. To make the MCP server push org writes for you, set `"orgSync": "server"` in `~/.total-recall/config.json` and restart the assistant (1.7.0): after a store, update or delete of an `org/` memory the server runs the same sync script the hook would, with the same lock and privacy filter. Pulling teammates' memories is still manual. Do not set `server` on Claude Code or Gemini, where the hooks already push. Without `orgSync`, run by hand: from the plugin folder, run `bash hooks/scripts/pull-org-vault.sh` to pull teammates' memories and `node scripts/sync-org-memory.mjs <key>` to push one memory.

**How it behaves**

- **Shared:** only memories explicitly tagged `org`. Automatic capture writes to the personal vault only.
- **Protected, weakly:** the tools refuse to change an org memory written by someone else, compared by OS username (two teammates with the same username, for example `ubuntu`, count as the same author). That is not access control: anyone with push access can edit the repo directly. Control who can push.
- **Not reviewed:** an org memory is live for everyone as soon as it is pushed. Sync pushes straight to the branch, so do not require pull requests on it.
- **Cost grows with the team:** every teammate's org memories are part of everyone's index. Use `orgInjection: "titles"` (or `"off"`) for a large team.
- **Someone leaves:** remove their push access. Their memories stay in the repo; edit or delete them with ordinary git commits.

**Team rollout checklist**

1. Pilot with one or two people on a private repo.
2. Watch `get_stats` (errors, totals) and the size of the injected index; about 30–40 tokens per memory ([QUALITY.md → Scale](../../docs/QUALITY.md#scale)).
3. Add the rest of the team and set `orgInjection` for the team size.
4. Offboarding is revoking push access (see above).

Starting solo and adding the team later needs no migration: re-run `./install.sh --org-repo …`.

**Stopping team sync.** Remove `orgRepo` from `~/.total-recall/config.json` and restart the assistant. Then each session start prints "Org vault skipped: orgRepo not set", no pull happens, and a memory tagged `org` is still written to the local org vault but its push fails at once with "orgRepo is not set" from the sync script (that early exit is not written to `.sync-errors.log`, so the session-start warning does not appear). The local org vault stays on disk and stays indexed, so teammates' old memories remain searchable; delete `~/.total-recall/org/` to remove them. Memories already pushed stay in the team repo and in its history: to purge one, rewrite the history with `git filter-repo` and ask every teammate to re-clone.

## 🚛 Fleet and unattended installs

For many machines, run `install.sh -y` as the target user (it writes to that user's home and `~/.claude`).

- **Exit codes:** `0` unless the script stops with an error (`1`). By default a skipped or failed MCP registration is only a warning and still exits `0` — so an unattended install cannot tell from the exit code that it ended up without a working server.
- **`--strict` (recommended for unattended installs):** makes the final verification decide the exit code. With `--strict` the script exits `1` when `dist/index.js` is missing or the MCP server is not registered, listing each problem first. Every step still runs (so the summary stays complete); only the exit code changes.

  ```bash
  ./install.sh -y --strict || echo "total-recall install incomplete"
  ```

  Without `--strict`, check afterwards with `claude mcp get plugin:total-recall:total-recall` (marketplace install) or `claude mcp get total-recall` (script install).
- **Re-runs and existing config:** safe. An existing `~/.total-recall/config.json` is merged, not replaced.
- **Network:** the Minimal profile (`--no-vector`) needs none after the plugin itself is fetched. The Complete profile runs `npm install` for the vector packages and downloads the embedding model (449 MB) from Hugging Face on the first semantic search; the model is cached in `~/.total-recall/models/`, which you can copy to a machine without internet access.
- **Gemini/Antigravity:** `-y --gemini` skips `agy plugin install` and prints the command to run.
- **Versions:** there is no version pin. `claude plugin update` moves to the newest release; to hold a version, do not update.
- **Not tested at scale:** these notes come from reading the scripts, not from a fleet rollout.

## 🔐 Privacy model — what is blocked, what is only warned

Two layers, with different threat models:

- **Org vault (shared repo) — hard block.** The org-sync hook runs a fail-closed privacy filter *before* `git add`: it refuses to push any memory containing a secret token / API key (known-prefix `sk-`, `ghp_`, `AKIA`…, PEM headers; labeled-generic `api_key:` / `Authorization: Bearer` / `password =` forms; high-entropy mixed-class blobs), a credit card (Luhn-validated), an IBAN (ISO 13616 mod-97-validated), a formatted phone number, or a personal email outside your `--allowed-email-domain`. The filter is best-effort pattern matching, not a guarantee: a labelled secret (`api_key: …`) is caught only when its value has 16 or more characters, and an unlabelled secret only when it has a known prefix or looks like a high-entropy mixed-case string. It covers pushes made by the sync hook only: a raw `git push` in the org repo skips it.
- **Personal vault (local, in the clear) — non-blocking warning only.** The personal vault stores content verbatim and is local to your machine (the embedder runs in-process and the vault itself is never pushed; the model provider still sees any memory the assistant reads), so a secret stored there is not a *remote* leak — but it IS sitting on disk in the clear. `store_memory` writes a one-line stderr warning when the body looks like a known-prefix secret token (`sk-…`, `ghp_…`, `AKIA…`, PEM headers). It does **not** block the store — the broader labeled-generic / high-entropy / financial / email detectors are intentionally NOT applied to the personal vault, to keep the personal-vault false-positive rate near zero (a noisy warning you learn to ignore is worse than no warning). If you need a hard guarantee a secret never touches disk, do not store it in any vault — the personal vault is not encrypted.


## 🏷️ Same name, other plugins

Other published plugins are also called `total-recall` (for example `total-recall@88plug`).
Plugin names share one namespace per client, so install this one by its full marketplace
ID, `total-recall@my-claude-plugins`, and don't install two plugins with the same name side by
side. Run `claude plugin list` to see which one is active. If you also have the official
`remember` plugin, disable it: both inject memory at SessionStart and do the same job.

## 🧭 Enabling vector search later

```bash
cd plugins/total-recall
npm install --no-save @huggingface/transformers sqlite-vec better-sqlite3
npm run build
```

(`npm run build` here rebuilds your local `dist/`, which is gitignored — it changes only your working copy.)

Or just re-run `./install.sh --complete`.

## 🤖 Codex CLI (MCP only, no hooks)

Codex CLI speaks MCP but does **not** run Claude Code lifecycle hooks, so the SessionStart memory-index injection, PostToolUse org-vault sync, and PreCompact learning capture do not fire. You get the 22 MCP tools (read/write/search via `recall_memory`, `search_index`, `store_memory`, …) but no automatic capture or proactive injection — call the tools explicitly.

To wire it, add the server to `~/.codex/config.toml` (hooks are simply ignored):

```toml
[mcp_servers.total-recall]
command = "bash"
args = ["/home/you/total-recall-plugin/plugins/total-recall/scripts/start-server.sh"]
```

Then put the memory instructions from the README in `AGENTS.md`. Memory is fully usable on demand; only the auto-capture hooks are absent. If the client reads MCP resources and prompts, `total-recall://index` and the `memory-workflow` / `extract-session-learnings` prompts stand in for the hooks.

## ✅ Verify

Start a new session; the memory index should be injected automatically (Claude Code). Or ask: *"what do you remember about …"* → the model calls `recall_memory`. `get_stats` shows totals, cache stats, and recent errors.

### `get_stats` says vector search is off after `claude plugin update`

A fresh `claude plugin update` creates a new version dir under `~/.claude/plugins/cache/.../<VERSION>/` and does **not** re-run `install.sh`, so the `better-sqlite3` native binding can be left source-only (no `build/Release/better_sqlite3.node`). When that happens `get_stats` reports `vector.depsPresent: false` / `vector.enabled: false` — the one honest "disabled" state. The in-process self-heal in `vectorStore.ts` tries `npm rebuild better-sqlite3` once on first load; if it still shows false, run it manually in that version dir:

```bash
cd ~/.claude/plugins/cache/my-claude-plugins/total-recall/<VERSION>
npm rebuild better-sqlite3
```

(With deps properly installed, `get_stats` reports `vector.enabled: true` from a fresh session — vector search defaults to on.)
