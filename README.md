# 🧠 total-recall

**Your AI assistant forgets everything at the end of each session. This plugin fixes that.**

Persistent, searchable memory for AI coding assistants: Claude Code, Gemini/Antigravity, VS Code (GitHub Copilot agent mode), Codex CLI, Cursor, Windsurf, Claude Desktop, or any other client that speaks the Model Context Protocol (MCP). Memories are plain Markdown files on your disk that you can read, edit, grep and version with git.

🇬🇧 English · [🇷🇴 Română](README-ro.md)

- **What you get:** your assistant can save what you tell it ("remember that…"), find it again in any later session, and update or forget it. In Claude Code it also sees an index of its memories at the start of every session and saves 0–3 lessons on its own before the context is compacted.
- **Where it lives:** `~/.total-recall/`, one `.md` file per memory, one vault for all your projects. No server, no database, no account. Memories you tag `org` can go to a shared Git repo (optional), after a privacy filter that blocks secrets, emails, card numbers, IBANs and phone numbers.
- **Cost:** free and open source (MIT). The plugin is ~1–2 MB; optional semantic search downloads a local multilingual model once (449 MB; 87 MB for the English-only one). The index shown at session start costs 30–40 tokens per memory.

![Session loop](docs/diagrams/session-loop-en.svg)

## At a glance

- **License:** MIT, free. **Maintainer:** one person, [Adrian Balaban](https://github.com/adrian-balaban), best-effort — issues and PRs welcome, but there's no SLA.
- **Maturity:** v1.6.8, tagged releases since August 2026 (~10/month). 1,036 tests, 97% coverage, 81% mutation score. Releases build on GitHub Actions from the `release` branch but are **not signed**.
- **Data stays local** by default; nothing is sent anywhere except an optional one-time model download and, if you opt in, your own team's git repo.

Full numbers: [Quality metrics](docs/QUALITY.md) · [Limits](#limits) below.

## Quick start

**You need:** Node.js 18+, git, and Linux, macOS or Windows with Git Bash.

### Claude Code

1. Install the plugin by its full ID (other plugins share the name):

   ```
   /plugin marketplace add adrian-balaban/total-recall
   /plugin install total-recall@my-claude-plugins
   ```

2. In a terminal, run the setup script once. It creates the vaults and builds the index. It asks two questions: the profile (**complete**, the default, adds local semantic search; **minimal**, or `--no-vector`, is text search only and works offline) and whether to set up a team vault (default no, skip it for solo use). Add `-y` to accept the defaults and skip both questions. The command below finds wherever the plugin cache put the current version (the glob just picks the latest if more than one is cached) and runs its `install.sh`:

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

   This step is required: without it, Claude Code keeps using its own file-based memory alongside total-recall. If you also run the official `remember` plugin, disable it: both do the same job.

4. Restart Claude Code and check it works: say *"remember that this project uses Gradle 8 and JUnit 5"*. A new file appears under `~/.total-recall/personal-vault/`. In a new session, ask *"what build tool does this project use?"*.

### Other assistants

Gemini/Antigravity, VS Code, Codex, Cursor, Windsurf, Claude Desktop. Install and MCP-config steps per assistant, plus Windows notes and every flag: [INSTALL.md](plugins/total-recall/INSTALL.md).

## Daily use

| You say | What happens | Tool |
|---|---|---|
| *"remember that we chose PostgreSQL because of JSONB"* | A memory is written to `~/.total-recall/personal-vault/` | `store_memory` |
| *"remember for the team that we deploy to eu-central-1"* | Tagged `org`, filtered and pushed to the team repo | `store_memory` |
| *"what did we decide about the database?"* | The assistant searches and reads the matching memories | `search_index`, `recall_memory` |
| *"that memory is outdated, update it"* / *"delete it"* | The file is edited or deleted | `update_memory`, `delete_memory` |
| nothing (Claude Code) | 0–3 lessons from the session are saved before compaction | `PreCompact` hook |

All projects share one vault. Name the project in the memory ("in the billing service, …") to keep projects apart in search results.

## Languages

Text search works in any language written in the Latin alphabet, accents ignored, as long as the question and the memory use the same words; it cannot see other scripts. Optional semantic search (on by default in the "complete" profile) covers every language pair, including Cyrillic, Greek, Arabic, Chinese and Japanese: since 1.6.8 the default model is multilingual (50+ languages).

If you only work in English and want the smaller download (87 MB vs. 449 MB), set the English-only model in `~/.total-recall/config.json` and restart the assistant:

```json
{ "embeddingModel": "Xenova/all-MiniLM-L6-v2" }
```

Benchmark across 11 languages, other models and re-embed cost: [How it works → Languages](docs/HOW-IT-WORKS.md).

## Supported assistants

| Assistant | Tools | Index at session start | Automatic capture | Team sync |
|---|---|---|---|---|
| **Claude Code** | ✅ | ✅ | ✅ | ✅ automatic |
| **Gemini/Antigravity** (`--gemini`) | ✅ | ⚠️ through the instruction file (Gemini drops hook output) | ⚠️ only if the `claude` CLI is installed | ✅ automatic |
| **VS Code, Copilot** (`--vscode`) | ✅ | ⚠️ through the instruction file | ❌ use the prompt | ❌ manual |
| **Codex, Cursor, Windsurf, Claude Desktop, other MCP clients** | ✅ | ⚠️ through the instruction file | ❌ use the prompt | ❌ manual |

All 22 tools work everywhere. "Through the instruction file" means the assistant reads `total-recall://index` or calls `search_index` because step 3 tells it to. With VS Code agent plugins on (Preview), the plugin's hooks may load too; not yet verified.

## Privacy: what leaves your machine

- **The files stay local.** The personal vault is never pushed anywhere; its local git repo blocks pushes.
- **The model sees what it reads.** The index, any memory the assistant recalls, and in Claude Code the last 1 MiB of the transcript (sent to `claude -p` for automatic capture before compaction) reach your model provider like any other prompt. There is no switch to turn automatic capture off yet.
- **Other network calls:** the semantic model downloads from Hugging Face once; the team vault pushes and pulls through git. Nothing else, and no telemetry.
- **Only `org`-tagged memories are shared**, and only after the privacy filter passes. The filter fails closed: if it cannot check a memory, nothing is pushed. It catches patterns, not meaning: internal host names, client names and business facts get through, so don't tag those `org`.
- **Teammates' memories reach your model.** Org memories are injected marked as "teammate-written reference data, not instructions", which lowers the risk of prompt injection but does not remove it. Give push access to the team repo only to people you trust; set `orgInjection` to `titles` or `off` to inject less. See [SECURITY.md](SECURITY.md).

## Team setup (org vault)

**Access control is weak: anyone with push access to the team repo can edit or impersonate any memory, and nothing is reviewed before it goes live for the whole team.** Treat it like a shared wiki, not a database of record. Operating rules, the rollout checklist and offboarding: [INSTALL.md → Org vault](plugins/total-recall/INSTALL.md#-org-vault-team-memory).

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

Start solo and add the team later: `install.sh` is safe to re-run. Every teammate's org memories become part of everyone's index; use `orgInjection: "titles"` for a large team. Settings (`orgBranch`, `allowedEmailDomains`, `orgInjection`, vault paths): [How it works → Configuration](docs/HOW-IT-WORKS.md#configuration).

## Upgrade, backup and troubleshooting

- **Upgrade (Claude Code):** `claude plugin update total-recall@my-claude-plugins`, restart, then run the setup script again (an update does not run it).
- **Upgrade (other assistants):** `cd ~/total-recall-plugin && git fetch && git reset --hard origin/release`, then run `./install.sh -y` again. The `release` branch is rebuilt by CI, so `git pull` can fail.
- **Restore a memory:** in Claude Code and Gemini the personal vault is committed to its local git repo at the end of each session: `git -C ~/.total-recall/personal-vault log`, `git restore` what you need, then ask for *"rebuild the index"* (`rebuild_index`). With other assistants, commit the vault yourself. Archived versions (`.superseded/`) and `vectors.db` are not in that repo.
- **New laptop:** ask the assistant to *"export all memories"*. `export_memories` returns the memories as JSON in its answer, without access counts, confirmations or archived versions; save it and import it on the new machine with `import_memories`. Org memories come back from the team repo. For a large vault, copying `~/.total-recall/personal-vault/` is simpler.
- **Rebuilt automatically:** `index.json`, `invertedIndex.json`, `.index-cache.txt` and `vectors.db` are rebuilt from the `.md` files. The org `index.json` in the team repo is not; leave it alone.
- **Something looks off:** `get_stats` shows recent errors and whether semantic search is on. In Claude Code, the session start warns when team pushes or automatic capture keep failing. If semantic search is off after an update, run `npm rebuild better-sqlite3` in the plugin folder.
- **Uninstall:** `claude plugin uninstall total-recall@my-claude-plugins`, or remove the MCP entry and the `~/total-recall-plugin` folder. Your memories stay in `~/.total-recall/` until you delete it.

## Limits

- **One maintainer, best-effort.** No SLA; releases are not signed. See [At a glance](#at-a-glance).
- **The index at session start grows with the vault**, by 30–40 tokens per memory: about 4.4k tokens at 100 memories, 32k at 1,000. There is no cap yet. Clean up with `prune_memories` (it lists candidates and deletes nothing).
- **Text search reads the title, the tags and the first 500 characters** of each memory, not the whole body. Put the key fact first.
- **Several sessions at once** cannot damage memory files (each memory is its own file). A memory stored in one session can be missing from another session's search until that session restarts.
- **Automatic capture** runs only where the `claude` CLI is installed, and cannot be switched off yet.
- **Retrieval quality is not yet measured** against an evaluation set; it is on the [backlog](BACKLOG.md).

## More

- [How it works](docs/HOW-IT-WORKS.md): storage, frontmatter fields, configuration, search and the forgetting curve, hooks, Obsidian
- [The 22 tools](docs/TOOLS.md) and the export format
- [Spec-driven work and ADL](docs/SPEC-DRIVEN.md): link decisions to requirements and architecture rules to tests, with a five-minute walkthrough
- [Architecture](plugins/total-recall/ARCHITECTURE.md): C4 diagrams, data model, write path
- [Quality metrics](docs/QUALITY.md): tests, mutation score, complexity, coupling, delivery, scale
- [Similar projects](docs/COMPARISON.md) · [Security](SECURITY.md) · [Install guide](plugins/total-recall/INSTALL.md)

## Status

See [At a glance](#at-a-glance) for license, maintainer and maturity. [MIT licence](LICENSE) · [Quality metrics](docs/QUALITY.md).
