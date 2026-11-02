# 🧠 total-recall

**Your AI assistant forgets everything at the end of each session. This plugin fixes that.**

Persistent, searchable memory for AI coding assistants: Claude Code, Gemini/Antigravity, VS Code (GitHub Copilot agent mode), Codex CLI, Cursor, Windsurf, Claude Desktop, or any other client that speaks the Model Context Protocol (MCP). Memories are plain Markdown files on your disk that you can read, edit, grep and version with git.

🇬🇧 English · [🇷🇴 Română](README-ro.md)

- **What you get:** your assistant can save what you tell it ("remember that…"), find it again in any later session, and update or forget it. In Claude Code it also sees an index of its memories at the start of every session and saves 0–3 lessons on its own before the context is compacted.
- **Where it lives:** `~/.total-recall/`, one `.md` file per memory, one vault for all your projects. No server, no database, no account.
- **Team memory (optional):** memories you tag `org` go to a shared Git repo, after a privacy filter that blocks secrets, emails, card numbers, IBANs and phone numbers.
- **Cost:** free and open source (MIT). The plugin is ~1–2 MB; optional semantic search downloads a local model (87 MB by default). The index shown at session start costs 30–40 tokens per memory.

![Session loop](docs/diagrams/session-loop-en.svg)

## 🚀 Quick start

**You need:** Node.js 18+, git, and Linux, macOS or Windows with Git Bash.

### Claude Code

1. Install the plugin by its full ID (other plugins share the name):

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. In a terminal, run the setup script once. It creates the vaults and builds the index. It asks two questions: the profile (**complete**, the default, adds local semantic search; **minimal**, or `--no-vector`, is text search only and works offline) and whether to set up a team vault (default no). Add `-y` to accept the defaults.

   ```bash
   bash "$(ls -d ~/.claude/plugins/cache/my-claude-plugins/total-recall/*/ | sort -V | tail -1)install.sh"
   ```

3. Tell Claude to use total-recall instead of its built-in `MEMORY.md` files. Add this to `~/.claude/CLAUDE.md`:

   ```markdown
   ## Memory
   Use total-recall exclusively for all memories, in every project.
   - Store via `store_memory` / `update_memory`; recall via `search_index` / `recall_memory` / `get_memories_by_keys`.
   - NEVER use the harness file-based memory (`memory/`, `MEMORY.md`) or `.remember/`.
   - If total-recall is unavailable, tell me and skip persisting — do not silently fall back.
   ```

   If you also run the official `remember` plugin, disable it: both do the same job.

4. Restart Claude Code and check it works: say *"remember that this project uses Gradle 8 and JUnit 5"*. A new file appears under `~/.total-recall/personal-vault/`. In a new session, ask *"what build tool does this project use?"*.

### Other assistants

1. Get the plugin. The `release` branch has the built files:

   ```bash
   git clone --depth 1 -b release https://github.com/adrian-balaban/total-recall.git ~/total-recall-plugin
   cd ~/total-recall-plugin/plugins/total-recall
   ```

2. Run the setup script once (same questions as above; `-y` accepts the defaults). For Gemini/Antigravity and VS Code it also registers the server:

   ```bash
   ./install.sh -y              # any assistant
   ./install.sh -y --gemini     # Gemini/Antigravity: registers the extension and its hooks (needs the agy CLI)
   ./install.sh -y --vscode     # VS Code / Copilot: adds the server to your user mcp.json
   ```

3. For other assistants, add the server to their MCP configuration yourself. Use an absolute path. `scripts/start-server.sh` finds Node even when the assistant starts without it on `PATH`:

   | Assistant | Config file | Entry |
   |---|---|---|
   | Codex CLI | `~/.codex/config.toml` | `[mcp_servers.total-recall]`<br>`command = "bash"`<br>`args = ["/home/you/total-recall-plugin/plugins/total-recall/scripts/start-server.sh"]` |
   | Cursor | `~/.cursor/mcp.json` | `{"mcpServers": {"total-recall": {"command": "bash", "args": ["/home/you/…/scripts/start-server.sh"]}}}` |
   | Windsurf | `~/.codeium/windsurf/mcp_config.json` | same JSON as Cursor |
   | Claude Desktop | `claude_desktop_config.json` | same JSON as Cursor |
   | Gemini CLI | `~/.gemini/settings.json` | same JSON as Cursor |

4. Tell the assistant how to use it. Put this in its instruction file (`AGENTS.md` for Codex, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules`, `.windsurfrules`):

   ```markdown
   ## Memory
   Use the total-recall MCP server for all memories.
   - At the start of a task, read the `total-recall://index` resource (or call `search_index`) to see what is already known.
   - Store decisions, preferences and lessons with `store_memory`; update with `update_memory`.
   - Before ending a long session, follow the `extract-session-learnings` prompt and store what it finds.
   ```

5. Restart the assistant and check it works the same way as in step 4 above.

More detail, Windows notes and every flag: [INSTALL.md](plugins/total-recall/INSTALL.md).

## 🗣️ Daily use

| You say | What happens | Tool |
|---|---|---|
| *"remember that we chose PostgreSQL because of JSONB"* | A memory is written to `~/.total-recall/personal-vault/` | `store_memory` |
| *"remember for the team that we deploy to eu-central-1"* | Tagged `org`, filtered and pushed to the team repo | `store_memory` |
| *"what did we decide about the database?"* | The assistant searches and reads the matching memories | `search_index`, `recall_memory` |
| *"that memory is outdated, update it"* / *"delete it"* | The file is edited or deleted | `update_memory`, `delete_memory` |
| nothing (Claude Code) | 0–3 lessons from the session are saved before compaction | `PreCompact` hook |

All projects share one vault. Name the project in the memory ("in the billing service, …") to keep projects apart in search results.

## 🌍 Languages

Search has two parts, and they handle languages differently:

- **Text search** works in any language written in the Latin alphabet (English, Romanian, French, German, Spanish, Polish, …), with accents ignored, as long as the question and the memory use the same words. It does not index other scripts: Cyrillic, Greek, Arabic, Chinese or Japanese text is invisible to it.
- **Romanian ↔ English** is built in: with `"enableMultilingualSearch": true`, a fixed dictionary of about 28 common words (decision/decizie, database/baza de date, …) translates the question, so text search alone finds an English memory from a Romanian question and the other way round.
- **Any other language pair** goes through semantic search, and depends on the local embedding model. The default model handles English only. Switch to a multilingual model to search across languages, including non-Latin scripts.

Measured with the plugin's own pipeline: one English memory, one English decoy, and the same question asked in 11 languages.

| `embeddingModel` | Size | Languages | Found the right memory |
|---|---|---|---|
| `Xenova/all-MiniLM-L6-v2` (default) | 87 MB | English | English clearly; elsewhere barely, and 2 of 10 languages wrong |
| **`Xenova/paraphrase-multilingual-MiniLM-L12-v2`** (recommended) | 449 MB | 50+ | All 11 (en, ro, fr, de, es, it, pl, ru, ja, zh, ar), with English-level margins |
| `Xenova/multilingual-e5-small` | 449 MB | ~100 | All 11, but with small margins: the plugin does not add the `query:`/`passage:` prefixes this model expects |

To switch, set the model in `~/.total-recall/config.json`, restart the assistant, and ask it to *"rebuild the index with re-embedding"* (`rebuild_index` with `forceReembed: true`), so existing memories are embedded again with the new model:

```json
{ "embeddingModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2" }
```

Any [`@huggingface/transformers`](https://huggingface.co/models?library=transformers.js) feature-extraction model with mean pooling works. Models that expect CLS pooling (LaBSE, bge-m3) load but rank worse. The model downloads from Hugging Face once, then runs locally.

## 🔒 Privacy: what leaves your machine

- **The files stay local.** The personal vault is never pushed anywhere; its local git repo blocks pushes.
- **The model sees what it reads.** The index, any memory the assistant recalls, and in Claude Code the last 1 MiB of the transcript (sent to `claude -p` for automatic capture before compaction) reach your model provider like any other prompt. There is no switch to turn automatic capture off yet.
- **Other network calls:** the semantic model downloads from Hugging Face once; the team vault pushes and pulls through git. Nothing else, and no telemetry.
- **Only `org`-tagged memories are shared**, and only after the privacy filter passes. The filter fails closed: if it cannot check a memory, nothing is pushed. It catches patterns, not meaning: internal host names, client names and business facts get through, so don't tag those `org`.
- **Teammates' memories reach your model.** Org memories are injected marked as "teammate-written reference data, not instructions", which lowers the risk of prompt injection but does not remove it. Give push access to the team repo only to people you trust; set `orgInjection` to `titles` or `off` to inject less. See [SECURITY.md](SECURITY.md).

## 👥 Team setup (org vault)

1. Create a private Git repo on any host (GitHub, GitLab, Bitbucket, your own) with a branch named `knowledge` that has at least one commit:

   ```bash
   git clone https://github.com/your-org/team-vault.git && cd team-vault
   git switch -c knowledge && git commit --allow-empty -m "init" && git push -u origin knowledge
   ```

2. Each teammate runs the setup script with the repo (on GitHub, `gh auth login` first; elsewhere, git credentials that can push):

   ```bash
   ./install.sh --org-repo https://github.com/your-org/team-vault.git --allowed-email-domain yourcompany.com
   ```

3. From then on, in Claude Code and Gemini/Antigravity, a memory tagged `org` is pushed after it is stored, and each session pulls teammates' memories at start. Other assistants have no hooks to do this: run `bash hooks/scripts/pull-org-vault.sh` to pull and `node scripts/sync-org-memory.mjs <key>` to push one memory, from the plugin folder.

- **Shared:** only memories explicitly tagged `org`. Automatic capture writes to the personal vault only.
- **Protected, weakly:** the tools refuse to change an org memory written by someone else, compared by OS username. That is not access control: anyone with push access can edit the repo directly. Control who can push.
- **Not reviewed:** an org memory is live for everyone as soon as it is pushed. Sync pushes straight to the branch, so do not require pull requests on it.
- **Cost grows with the team:** every teammate's org memories are part of everyone's index. Use `orgInjection: "titles"` for a large team.
- **Someone leaves:** remove their push access. Their memories stay in the repo; edit or delete them with ordinary git commits.

## 💻 Supported assistants

| Assistant | Tools | Index at session start | Automatic capture | Team sync |
|---|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ automatic |
| **Gemini/Antigravity** (`--gemini`) | ✅ | ⚠️ through the instruction file (Gemini drops hook output) | ⚠️ only if the `claude` CLI is installed | ✅ automatic |
| **VS Code, Copilot** (`--vscode`) | ✅ | ⚠️ through the instruction file | ❌ use the prompt | ❌ manual |
| **Codex, Cursor, Windsurf, Claude Desktop, other MCP clients** | ✅ | ⚠️ through the instruction file | ❌ use the prompt | ❌ manual |

All 22 tools work everywhere. "Through the instruction file" means the assistant reads `total-recall://index` or calls `search_index` because step 4 tells it to. With VS Code agent plugins on (Preview), the plugin's hooks may load too; not yet verified.

## ⚙️ Configuration

Optional, in `~/.total-recall/config.json`:

```json
{
  "orgRepo": "https://github.com/you/your-vault.git",
  "orgBranch": "knowledge",
  "allowedEmailDomains": ["yourcompany.com"],
  "orgInjection": "index",
  "enableMultilingualSearch": true,
  "embeddingModel": "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
}
```

`orgInjection` is `index` (default), `titles` or `off`. Vault paths (`personalVault`, `orgVault`) and the spec-driven settings: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) and [docs/SPEC-DRIVEN.md](docs/SPEC-DRIVEN.md).

## 🔧 Upgrade, backup and troubleshooting

- **Upgrade (Claude Code):** `claude plugin update total-recall@my-claude-plugins`, restart, then run the setup script again (an update does not run it).
- **Upgrade (other assistants):** `cd ~/total-recall-plugin && git fetch && git reset --hard origin/release`, then run `./install.sh -y` again. The `release` branch is rebuilt by CI, so `git pull` can fail.
- **Restore a memory:** in Claude Code and Gemini the personal vault is committed to its local git repo at the end of each session: `git -C ~/.total-recall/personal-vault log`, `git restore` what you need, then ask for *"rebuild the index"* (`rebuild_index`). With other assistants, commit the vault yourself. Archived versions (`.superseded/`) and `vectors.db` are not in that repo.
- **New laptop:** ask the assistant to *"export all memories"*. `export_memories` returns the memories as JSON in its answer, without access counts, confirmations or archived versions; save it and import it on the new machine with `import_memories`. Org memories come back from the team repo. For a large vault, copying `~/.total-recall/personal-vault/` is simpler.
- **Rebuilt automatically:** `index.json`, `invertedIndex.json`, `.index-cache.txt` and `vectors.db` are rebuilt from the `.md` files. The org `index.json` in the team repo is not; leave it alone.
- **Something looks off:** `get_stats` shows recent errors and whether semantic search is on. In Claude Code, the session start warns when team pushes or automatic capture keep failing. If semantic search is off after an update, run `npm rebuild better-sqlite3` in the plugin folder.
- **Uninstall:** `claude plugin uninstall total-recall@my-claude-plugins`, or remove the MCP entry and the `~/total-recall-plugin` folder. Your memories stay in `~/.total-recall/` until you delete it.

## ⚖️ Limits

- **The index at session start grows with the vault**, by 30–40 tokens per memory: about 4.4k tokens at 100 memories, 32k at 1,000. There is no cap yet. Clean up with `prune_memories` (it lists candidates and deletes nothing).
- **Text search reads the title, the tags and the first 500 characters** of each memory, not the whole body. Put the key fact first.
- **Several sessions at once** cannot damage memory files (each memory is its own file). A memory stored in one session can be missing from another session's search until that session restarts.
- **Automatic capture** runs only where the `claude` CLI is installed, and cannot be switched off yet.
- **Retrieval quality is not yet measured** against an evaluation set; it is on the [backlog](BACKLOG.md).

## 📚 More

- [How it works](docs/HOW-IT-WORKS.md): storage, frontmatter fields, search and the forgetting curve, hooks, Obsidian
- [The 22 tools](docs/TOOLS.md) and the export format
- [Spec-driven work and ADL](docs/SPEC-DRIVEN.md): link decisions to requirements and architecture rules to tests, with a five-minute walkthrough
- [Architecture](plugins/total-recall/ARCHITECTURE.md): C4 diagrams, data model, write path
- [Quality metrics](docs/QUALITY.md): tests, mutation score, complexity, coupling, delivery, scale
- [Similar projects](docs/COMPARISON.md) · [Security](SECURITY.md) · [Install guide](plugins/total-recall/INSTALL.md)
- [Talk: Claude vs Ollama & Total Recall](https://github.com/adrian-balaban/presentation-claude-vs-ollama-and-total-recall-plugin-21-07-2026) (Romanian, July 2026)

## 📊 Status

**v1.6.7.** Tagged releases since August 2026, about ten a month; 30% of them needed a follow-up fix ([details](docs/QUALITY.md)). 1,030 tests, 97% coverage, 80% mutation score. Releases install from the `release` branch, which GitHub Actions builds only after all of that passes; they are not signed. [MIT licence](LICENSE). Maintained by one person, [Adrian Balaban](https://github.com/adrian-balaban), on a best-effort basis; issues and pull requests are welcome.
