# 🧠 total-recall

**Your AI assistant forgets everything at the end of each session. This plugin fixes that.**

Persistent, searchable memory for Claude Code, Gemini/Antigravity and VS Code (GitHub Copilot agent mode). Built as a standard Model Context Protocol (MCP) server backed by plain Markdown files on your disk that you can read, edit, grep and version with git.

🇬🇧 English · [🇷🇴 Română](README-ro.md)

- **What you get:** at the start of every session Claude sees a short index of what it knows about you and your projects, reads the full memory when it needs it, and saves new decisions, lessons, and architectural rules as you work.
- **Where it lives:** `~/.total-recall/`, one `.md` file per memory. No server, no database, no account.
- **Team memory (optional):** memories you tag `org` go to a shared Git repo through a privacy filter that blocks secrets, emails and card numbers.
- **Cost:** free and open source (MIT). The plugin is ~1–2 MB; optional semantic search downloads a ~200 MB local model. The injected index costs about 32 tokens per memory in every session.

![Session loop](docs/diagrams/session-loop-en.svg)

## 🚀 Quick start

**You need:** Claude Code with the `claude` CLI, Node.js 18+, and Linux, macOS or Windows with Git Bash.

1. In a Claude Code session, install the plugin by its full ID (other plugins share the name):

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. In a terminal, run the setup script once. It creates the vaults, builds the index and asks for a profile: **complete** (the default, adds local semantic search) or **minimal** (text search only, works offline).

   ```bash
   # Run the setup script from the installed plugin cache:
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
   # (Or navigate to the total-recall directory in your plugin cache and run ./install.sh)
   ```

   > 💡 **Important:** Add the memory directive from [Daily use](#daily-use) to your global `~/.claude/CLAUDE.md` (or your project's root `CLAUDE.md`) so Claude routes all memories to total-recall instead of its native `MEMORY.md`.

3. Restart Claude Code and open a new session. To check it works:
   - say *"remember that this project uses Gradle 8 and JUnit 5"*,
   - open another new session and ask *"what build tool does this project use?"*,
   - or ask *"show total-recall stats"* (`get_stats`).

Gemini/Antigravity: add `--gemini`. VS Code with agent plugins off: add `--vscode`. Full guide, Windows notes and Codex CLI: [INSTALL.md](plugins/total-recall/INSTALL.md).

## 🗣️ Daily use

| You say | What happens | MCP Tool |
|---|---|---|
| *"remember that we chose PostgreSQL because of JSONB"* | A memory is written to `~/.total-recall/personal-vault/` | `store_memory` |
| *"remember for the team that we deploy to AWS eu-central-1"* | Filtered & pushed to shared team Git repo | `store_memory` (tag: `org`) |
| *"what did we decide about the database?"* | Claude searches index and reads matching memories | `search_index` / `recall_memory` |
| *"that memory is outdated, update it"* / *"forget it"* | The file is edited or deleted | `update_memory` / `delete_memory` |
| *nothing* | 0–3 lessons from the session are saved before compaction | `PreCompact` hook |

To make total-recall your only memory, so Claude stops using its built-in `MEMORY.md` files, add this to your **global** `~/.claude/CLAUDE.md` (or the project root's `CLAUDE.md` to share with your team):

```markdown
## Memory
Use total-recall exclusively for all memories, in every project.
- Store via `store_memory` / `update_memory`; recall via `search_index` / `recall_memory` / `get_memories_by_keys`.
- NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
- If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
```

If you also run the official `remember` plugin, disable it: both do the same job.

## 🔒 Privacy: what leaves your machine

- **The files stay local.** The personal vault is never pushed anywhere; its local git repo blocks pushes.
- **The model sees what it reads.** The injected index, any memory Claude recalls, and the last 1 MiB of the transcript (sent to `claude -p` for automatic capture before compaction) reach your model provider like any other prompt. PreCompact capture can be disabled in `config.json` if restricted by policy.
- **Only `org`-tagged memories are shared**, and only after the privacy filter passes. The filter fails closed: if it cannot check a memory, nothing is pushed.
- **Teammates' memories reach your model.** Org memories are injected marked as "teammate-written reference data, not instructions", but that lowers the risk of prompt injection rather than removing it. Give push access to the org repo only to people you trust; set `orgInjection` to `titles` or `off` to reduce what is injected. See [SECURITY.md](SECURITY.md).

## 👥 Team setup (org vault)

1. Create a private Git repo with a branch named `knowledge` (or set `orgBranch`) that has at least one commit, and run `gh auth login`.
2. Each teammate runs the setup script with the repo:

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh" \
     --org-repo https://github.com/your-org/team-vault.git --allowed-email-domain yourcompany.com
   ```

3. From then on, a memory tagged `org` is pushed after it is stored, and each session pulls teammates' memories at start.

- **Instant onboarding:** New teammates inherit the team's entire architectural context and project conventions from their very first session.
- **Shared:** only memories explicitly tagged `org`. Automatic capture writes to the personal vault only.
- **Protected:** the tools refuse to change an org memory written by someone else (checked by OS username). Teammates who leave can have memories reassigned or edited directly via standard Git commits.
- **Not reviewed:** an org memory is live for everyone as soon as it is pushed (enable GitHub branch protection on `knowledge` if peer review is desired).

## 💻 Supported clients

| Client | Tools | Index at session start | Automatic capture |
|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ |
| **Gemini/Antigravity** (`--gemini`) | ✅ | ❌ Gemini drops hook output; the model reads `total-recall://index` | ✅ |
| **VS Code, Copilot agent mode** | ✅ | ⚠️ with agent plugins (Preview, not yet verified); with `--vscode`, via `total-recall://index` | ⚠️ agent plugins only |
| **Codex CLI** | ✅ | ❌ call the tools yourself | ❌ |

It also works with `ollama launch claude`: same vault, whatever model Claude Code talks to.

## ⚙️ Configuration

Optional, in `~/.total-recall/config.json`:

```json
{
  "orgRepo": "https://github.com/you/your-vault.git",
  "orgBranch": "knowledge",
  "allowedEmailDomains": ["yourcompany.com"],
  "orgInjection": "index",
  "enableMultilingualSearch": true,
  "personalVault": "~/my-personal-vault"
}
```

`orgInjection` is `index` (default), `titles` or `off`. `enableMultilingualSearch` lets a Romanian question find an English memory and vice versa. All keys, including `embeddingModel` (defaults to `Xenova/all-MiniLM-L6-v2`, 384-dim), `orgVault` and the spec-driven block: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) and [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md).

## 🔧 Upgrade, backup and troubleshooting

- **Upgrade:** `claude plugin update total-recall@my-claude-plugins`, restart Claude Code, then run the setup script again (an update does not re-run it, and semantic search needs it).
- **Restore a memory:** the personal vault is a local git repo committed at the end of each session: `git -C ~/.total-recall/personal-vault log`, then `git restore` what you need, then ask Claude to *"rebuild the index"* (`rebuild_index`).
- **New laptop:** ask Claude to *"export all memories"* (`export_memories`, a portable JSON file) and import them on the new machine (`import_memories`). Org memories come back from the org repo.
- **Indexes are disposable:** `index.json`, `invertedIndex.json`, `.index-cache.txt` and `vectors.db` are all rebuilt from the `.md` files.
- **Something looks off:** `get_stats` shows recent errors and whether semantic search is on. SessionStart warns when org pushes or automatic capture keep failing. If semantic search is off after an update, run `npm rebuild better-sqlite3` in the newest folder under `~/.claude/plugins/cache/my-claude-plugins/total-recall/`.
- **Uninstall:** `claude plugin uninstall total-recall@my-claude-plugins`. Your memories stay in `~/.total-recall/` until you delete that folder.

## ⚖️ Limits

- **The injected index grows with the vault:** about 4.4k tokens at 100 memories (typical active project vaults range between 50–200 memories). Prompt caching makes recurrent session hits ~90% cheaper. Prune with `prune_memories` (lists candidates without deleting) or set `orgInjection: "titles"` to minimize footprint.
- **Search reads the title, the tags and the first 500 characters of each memory**, not the whole body. Write the key fact first; every memory starts with an executive summary.
- **Several sessions at once** are safe for content (each memory is its own file), but the last session to exit wins the access counts in `index.json`.
- **Retrieval quality is not yet measured** against an evaluation set; it is on the [backlog](BACKLOG.md).
- **Releases are built by CI.** The plugin installs from the `release` branch, which GitHub Actions builds after the test, coverage and mutation gate passes.

## 📚 More

- [How it works](docs/HOW-IT-WORKS.md): storage layout, frontmatter fields, hybrid search (TF-IDF + sqlite-vec via RRF), Ebbinghaus decay, hooks, Obsidian
- [The 22 tools](docs/TOOLS.md): core memory operations plus 5 dedicated architecture & ADL governance tools, and the export format
- [Spec-driven work and ADL](docs/SPEC-DRIVEN.md): link decisions to requirements and architecture rules to automated fitness tests, with a five-minute walkthrough
- [Architecture](plugins/total-recall/ARCHITECTURE.md): C4 diagrams, data model, write path
- [Quality metrics](docs/QUALITY.md): tests, mutation, complexity, coupling, DORA, scale
- [Similar projects](docs/COMPARISON.md) · [Security](SECURITY.md) · [Install guide](plugins/total-recall/INSTALL.md)
- [Talk: Claude vs Ollama & Total Recall](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin-21-07-2026) (Romanian, July 2026)

## 📊 Status

**v1.6.7**, stable. 1,006 unit and 24 integration tests pass; 97% statement coverage; 80% mutation score (Stryker gate at 65%). [MIT licence](LICENSE). Zero vendor lock-in. Maintained by one person, [Adrian Balaban](https://github.com/adrian-balaban); issues and pull requests are welcome on GitHub.
