# 🧠 Total Recall — Executive Overview

## 💬 In one sentence
A tool that gives your AI assistant persistent memory — memories are saved on your computer and survive across sessions, so you don't have to re-explain the same things every time.

## 📦 What it is
Total Recall is an extension (version 1.1.18) that plugs into Claude Code and Gemini CLI. Memories are Markdown files stored locally on your machine (under `~/.total-recall/`), organised in two places:
- **Personal vault** — your private memories
- **Team vault** — memories shared with colleagues (optional, synced via git)

When you look for a memory, the system finds it using a fast search method and "ranks" it by importance and how often it is used.

## ⚙️ What it does
- **Stores** memories as Markdown files with structured information (title, tags, category, importance).
- **Searches** memories quickly whenever you need them.
- **Ranks** results by relevance and by how recently you accessed each memory.
- **Separates** personal memories (yours only) from team memories (shared with others).
- **Protects** sensitive data (credit cards, personal emails, passwords) before syncing anything to the team.
- **Archives** older versions of memories instead of simply deleting them.
- **Injects** the memory index into Claude's context automatically at the start of every new session — this is the single most important feature.
- **Extracts** 0-3 lessons from the conversation automatically before context compaction (the `PreCompact` hook) and saves them.
- **Syncs** team memories through git, so every colleague has access.

## 🛠️ The 17 tools
Grouped by category:
- **Store:** `store_memory`
- **Search:** `recall_memory`, `search_index`
- **Read:** `list_memories`, `get_memories_by_keys`, `get_stats`, `get_timeline`, `get_related_memories`
- **Modify:** `update_memory`, `delete_memory`, `confirm_memory`, `rebuild_index`, `prune_memories`
- **Re-ranking:** `rerank_memories`
- **Bulk operations:** `export_memories`, `import_memories`, `delete_memories`

## 🔍 How it works, in plain terms
Each memory is an ordinary Markdown file with structured information at the top (title, tags, etc.). At startup the system reads every file, indexes them (for fast search) and is then ready to answer questions. When you search for something, retrieval uses two methods:
1. **Text search** — looks for the words in your memory
2. **Vector (semantic) search** (enabled by default at install time) — understands meaning, not just words

If the second method is unavailable, the system automatically falls back to the first. Memories are persisted to disk automatically, and if a colleague adds a new memory to git, it shows up in your session without needing a restart.

## 🚀 How to install it and where it runs
- **For Claude Code:** installed as a plugin from the menu
- **For Gemini CLI:** installed as an extension
- **For manual setup:** the `install.sh` script wires everything up — you choose between a lightweight profile (text search only) and the full, default one (with semantic/meaning-based search)
- **Compatibility:** works on any Linux/Mac plus Git Bash on Windows; requires Node.js 18+

## ✅ Quality and reliability
- **Tests:** 744 unit + 20 integration tests, all green · 45 files · ~13,000 lines of test code
- **Coverage:** 93.6% statements · 88.2% branches · 95.3% lines (the configured threshold wants 95% across the board, so `npm run test:coverage` still exits non-zero — see README status)
- **Mutation testing:** a method for checking whether the tests are actually any good. It takes the code and deliberately changes small things (e.g. `>` becomes `<`, `true` becomes `false`). If the tests don't notice the change and don't fail, they aren't strict enough. A tool called Stryker does this automatically.
  - Current score: 65.9% across 16 core modules (the tests catch 65.9% of the deliberately introduced faults; the threshold that breaks the build is 65%)
  - Headroom over that threshold is just 0.9 points, so a single new untested branch can turn CI red
- **Version:** 1.1.18 — stable
- **CI:** the GitHub Actions workflow `.github/workflows/mutation.yml` runs the Stryker gate on every push/PR to `main` and fails the build below 65%. On top of that, since the plugin is distributed straight from git (not through npm), every commit is also tested locally before being pushed

## 🔗 Dependencies
- **Essential:** 2 small packages (the MCP SDK and Zod for validation)
- **Optional:** 3 packages for smarter search (downloaded only if you ask for them)
  - The AI model for semantic understanding (~200MB)
  - A local database for vectors
- **Total size:** ~1-2MB for the plugin; ~200MB optional if you want semantic search

## 🧭 Design principles
- **Local-first:** all memories live on your own machine, not in the cloud
- **Readable:** every memory is a Markdown file you can edit with any editor
- **Versionable:** the files can be put in git and their changes tracked (the team vault does exactly that; the personal one stays local only)
- **No infrastructure:** it depends on no external server or database — the Markdown files are the source of truth (the vector index is just a local SQLite, regenerable at any time)
- **Fault-tolerant:** if something goes wrong, no data is lost

## 📡 How it maps to the [Thoughtworks Technology Radar Vol. 34 (2026)](https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/04/tr_technology_radar_vol_34_en_1.pdf)

The Thoughtworks Radar groups techniques and tools into four rings (Adopt = use it now, Trial = worth trying, Assess = keep an eye on it, Hold = proceed with caution). Vol. 34 is dominated by the maturing of AI agent engineering. Several recommended techniques are **already implemented** in Total Recall, as design decisions taken independently:

- **Progressive context disclosure** (Trial) + **Context engineering** (Adopt): don't dump the whole context at once (which leads to "context rot") — start with a lightweight index and load the detail on demand. That is exactly what the plugin does: at SessionStart it injects only the memory index, and the full content is read through `get_memories_by_keys` only when needed.
- **Mutation testing** (Trial): "the most honest signal" of test quality in the era of AI-generated code. The plugin already uses Stryker (see *Quality and reliability*).
- **Claude Code plugin marketplace** (Trial): git-based distribution with no "version drift" — precisely the plugin's model (git subdirectory, not npm).
- **Structured output from LLMs** (Adopt): the capture hook asks the model for JSON lines, not free text.
- **MCP by default** (Hold): the radar warns against reaching for MCP reflexively — the plugin keeps system operations (git, indexing) in plain scripts rather than MCP tools.

**Three future directions** taken from the radar (tracked in BACKLOG.md, each with a clear trigger): (1) a **context graph / temporal relationships** (*Context graph* + *Graphiti*) — the `supersededAt` chain already stores temporal edges, but there is no relationship-query layer; (2) **source-grounded extraction** (*LangExtract*) — capture produces JSON, but without traceability back to the conversation; (3) an **evaluation set** (*DeepEval*) — today there is no objective measure that `recall_memory` returns the right memory.

> The full synthesis (every Adopt/Trial item across the four quadrants) lives in the team memory `org/knowledge/thoughtworks-technology-radar-vol-34-2026-adopt-trial-synthesis`.
