# ⚙️ How Total Recall works

What the plugin stores, how it searches, and what each hook does. For the C4 diagrams (context → containers → components → code), the data model and the write path, see [ARCHITECTURE.md](../plugins/total-recall/ARCHITECTURE.md).

[← README](../README.md)

## 🗂️ Storage

Two separate vaults live under `~/.total-recall/`:

| Vault        | Path                              | When used                                                                |
| ------------ | --------------------------------- | ------------------------------------------------------------------------ |
| **Personal** | `~/.total-recall/personal-vault/` | Default for all memories. Stays local.                                   |
| **Org**      | `~/.total-recall/org/org-vault/`  | Memories tagged `org`. Synced to a shared Git repo through the privacy filter. |

```
~/.total-recall/
├── index.json               ← {v: 1, entries: key → metadata} (derived, rebuilt from the .md files)
├── invertedIndex.json       ← TF-IDF inverted index: token → {docs, idf} (derived)
├── .index-cache.txt         ← the text injected at SessionStart (written only by the SessionStart hook)
├── config.json              ← optional configuration
├── personal-vault/          ← a local-only git repo, snapshotted at the end of each session
│   ├── architecture/
│   │   └── db-choice.md     ← one memory: YAML frontmatter + Markdown body
│   ├── decisions/ …
│   ├── .superseded/         ← earlier versions of overwritten memories (never indexed)
│   └── vectors.db           ← sqlite-vec embeddings (optional, derived, git-ignored)
└── org/
    └── org-vault/           ← team memories, git-synced (branch from `orgBranch`)
        └── index.json       ← the team index, committed to the repo — NOT rebuilt locally, do not edit
```

The personal vault's local git repo ignores `.superseded/`, `*.tmp.*` and `vectors.db*`, so archived versions are not in its history. It is committed by the `SessionEnd` hook (Claude Code, Gemini/Antigravity); with other assistants, commit it yourself.

The key of a memory is its path relative to the vault root, without `.md`; org keys get the prefix `org/`. The category is the first folder under the vault root (`knowledge` for files at the root).

Each memory is one `.md` file:

```markdown
---
title: "Prefer PostgreSQL for relational data"
tags: [architecture, database, feedback]
author: adrianb
importanceScore: 0.8
created: 2026-06-01T10:00:00Z
updated: 2026-06-15T14:30:00Z
---

## Executive Summary

Prefer PostgreSQL over MySQL for new projects because of JSONB support…
```

### Frontmatter fields

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `title` | string | always | Shown in the index and search results |
| `tags` | string[] | always | `org` routes to the org vault; `no-prune` protects from pruning and deletion |
| `author` | string | always | OS username; org memories can only be changed by their author through the tools |
| `sessions` | string[] | `store`/`update` | Sessions that touched the memory (last 50) |
| `created`, `updated` | ISO time | always | `since`/`before` filters use `updated` |
| `importanceScore` | 0–1 | always | Slows the forgetting curve (0.3 low, 0.7 high, 1.0 critical) |
| `confirmations`, `flags` | number | `confirm_memory` | Useful / wrong feedback, fed into retention |
| `supersededAt` | ISO time[] | `store_memory(force=true)` | When earlier versions were archived to `.superseded/` |
| `system`, `artifact`, `elements`, `requirements`, `sourcePath`, `sourceRev`, `status`, `supersedes` | optional | spec-driven work | See [SPEC-DRIVEN.md](SPEC-DRIVEN.md) |

`accessCount` and `lastAccessed` are kept only in `index.json`, never in the file.

### Configuration

Optional, in `~/.total-recall/config.json`:

```json
{
  "orgRepo": "https://github.com/you/your-vault.git",
  "orgBranch": "knowledge",
  "allowedEmailDomains": ["yourcompany.com"],
  "orgInjection": "index",
  "enableMultilingualSearch": true
}
```

`orgInjection` is `index` (default), `titles` or `off`. `embeddingModel` is covered in [Languages](#languages). Vault paths are `personalVault` and `orgVault`; the server reads them once at start, so restart the assistant after changing them (a changed `orgVault` without a restart silently stops org sync); the spec-driven settings are in [SPEC-DRIVEN.md](SPEC-DRIVEN.md).

## 🧱 Design principles

- **Local-first.** The vault files live on your machine. There is no external server or database.
- **Readable.** Every memory is a Markdown file you can open in any editor or in [Obsidian](https://obsidian.md/).
- **Versionable.** The team vault is git-backed. The personal vault is a local-only git repo (created by `install.sh`, with a `pre-push` hook that blocks any push), committed at the end of each session.
- **Derived indexes.** `index.json`, `invertedIndex.json`, `.index-cache.txt` and `vectors.db` are all rebuilt from the `.md` files, so losing them loses no content.
- **Fault-tolerant.** If the vector path fails, search falls back to text search.
- **Several sessions at once.** Each memory is its own file, so sessions do not overwrite each other's memories. Memory files are written in place, not atomically, so a crash in the middle of a write can truncate one (tracked in [BACKLOG.md](../BACKLOG.md)). A memory stored in one session can be missing from another session's search until that session restarts, and `index.json` is written by whichever session writes last, which can reset `accessCount` and `lastAccessed` (a known limit, tracked in [BACKLOG.md](../BACKLOG.md)).

The only required dependencies are `@modelcontextprotocol/sdk` and `zod`. TF-IDF, the decay formula, RRF and the frontmatter parser are written from scratch:

1. **Security.** No `gray-matter`, so no `js-yaml` CVE class (GHSA-h67p-54hq-rp68). The parser is pinned by property-based tests (`fast-check`).
2. **One scoring formula.** Title boost, tag boost and decay are one formula, not three libraries.
3. **Determinism.** No LLM calls in the search path: no cost, works offline.
4. **Auditability.** `get_stats` reports totals, cache hits, latency percentiles and recent errors.

`@huggingface/transformers`, `sqlite-vec` and `better-sqlite3` are optional and only used for semantic search.

## 🔍 Search

```
recall_memory(query)
  │
  ├─ tfidfSearch(query)
  │    ├─ tokenize(query) → tokens (small built-in word-pair dictionary if enableMultilingualSearch)
  │    ├─ per token: look up the inverted index
  │    ├─ score = TF × IDF × title-boost(2×) × tag-boost(1.5×)
  │    └─ × retention strength (importance, days since update, accessCount, confirmations, flags)
  │
  ├─ [optional: vector deps installed]
  │    ├─ embed(query) → sqlite-vec nearest neighbours
  │    └─ Reciprocal Rank Fusion(tfidf, vector), k=60:  score(d) = Σ 1/(60 + rank_i(d))
  │
  └─ cut to `limit`; with full=true read the bodies and bump accessCount
```

TF-IDF indexes the title, the tags and the first 500 characters of the body, not the whole file. A word scores high when it is frequent in one memory and rare across the vault.

**Tokenizer** (`tfidf.ts`): lowercase, accents stripped (`întâlnire` → `intalnire`), and every character outside `a–z` and `0–9` becomes a separator. Letters with no accent-free form (`ß`, `ł`, `ø`, `æ`) are not converted, so they split a word. So `dim_customer` is two words, `dim` and `customer`. There is no stemming and no stop-word list. Text in non-Latin scripts (Cyrillic, Greek, Arabic, Chinese, Japanese) produces no tokens at all, so only semantic search can find it.

**Decay in hybrid mode:** the forgetting curve weights the TF-IDF ranking only. RRF then merges it with the vector ranking, which is not decayed, so with semantic search on an old memory fades more slowly than with text search alone.

### The forgetting curve

Unimportant, unused memories fade out of results; every access refreshes them (Ebbinghaus, 1885).

```
λ        = 0.16 × (1 − importanceScore × 0.8)
strength = clamp(importance × exp(−λ × daysSince)
                 × (1 + accessCount × 0.2 + confirmations × 0.1 − flags × 0.1), 0, 1)
```

| importanceScore | λ     | Behaviour                         |
| --------------- | ----- | --------------------------------- |
| 1.0 (critical)  | 0.032 | Slow decay, relevant for weeks    |
| 0.5 (normal)    | 0.096 | Medium decay                      |
| 0.3 (low)       | 0.122 | Fades from results within days    |

The `no-prune` tag keeps a memory out of `prune_memories` and blocks its deletion and overwrite. Use it for decisions you never want to lose.

### Semantic search (optional)

Lazy-loaded and fully local: no cloud API, no API key. Vectors are computed once at write time and stored in `vectors.db`. TF-IDF matches exact tokens ("k8s pod OOM" misses "workload killed for memory pressure"); the embedding model (`Xenova/paraphrase-multilingual-MiniLM-L12-v2` by default, 384 dimensions, 50+ languages) handles paraphrase and other languages. RRF merges the two rankings by position only, because lexical scores and cosine similarities are not comparable.

```bash
npm install --no-save @huggingface/transformers sqlite-vec better-sqlite3   # or ./install.sh --complete
```

### Languages

Cross-language search is done by the embedding model, so it works for any language pair the model covers. Text search alone matches only the words you typed; the one extra is a small built-in dictionary of about 28 Romanian ↔ English word pairs (`enableMultilingualSearch`), and no other language has one. With semantic search on: the default `Xenova/paraphrase-multilingual-MiniLM-L12-v2` handles 50+ languages; `Xenova/all-MiniLM-L6-v2` (the default up to 1.6.7) handles English only. When the configured model differs from the one that made the stored vectors, the next start rebuilds the vector index and re-embeds every memory ([TR-R6]). To switch to the English-only model (87 MB instead of 449 MB), set it in `~/.total-recall/config.json` and restart the assistant:

```json
{ "embeddingModel": "Xenova/all-MiniLM-L6-v2" }
```

**Benchmark.** Measured with the plugin's own pipeline: one English memory, one English decoy, and the same question asked in 11 languages.

| `embeddingModel` | Size | Languages | Found the right memory |
|---|---|---|---|
| **`Xenova/paraphrase-multilingual-MiniLM-L12-v2`** (default since 1.6.8) | 449 MB | 50+ | All 11 (English, Chinese, Spanish, French, German, Japanese, Arabic, Russian, Italian, Polish, Romanian), with English-level margins |
| `Xenova/all-MiniLM-L6-v2` (default up to 1.6.7) | 87 MB | English | English clearly; elsewhere barely, and 2 of 10 languages wrong |
| `Xenova/multilingual-e5-small` | 449 MB | ~100 | All 11, but with small margins: the plugin does not add the `query:`/`passage:` prefixes this model expects |

On every start the plugin compares the model that made the stored vectors with the configured one. When they differ, it rebuilds the vector index and re-embeds every memory in the background; text search keeps working meanwhile. `get_stats` shows the model in use. The multilingual model has twice as many layers, so each embedding takes about twice as long; you only notice it on the first re-embed of a large vault.

Models that expect CLS pooling (LaBSE, bge-m3) load but rank worse than mean-pooling models.

## 🪝 Hooks

| Event | Script | What it does |
|---|---|---|
| `SessionStart` | `pull-org-vault.sh` | `git pull` of the org vault (if configured) |
| | `build-memory-index.sh` | Runs `dist/build-index-cache.mjs`, the same walk and parser as the server, and writes `.index-cache.txt`. A failed build keeps the previous file and logs to `~/.total-recall/.index-cache.log` |
| | `load-memory-index.sh` | Injects the index (and, in an ADL project, a short architecture summary) into the session |
| | `check-extract-outcomes.sh` | Warns when at least 3 of the last 5 PreCompact runs failed |
| | `check-sync-errors.sh` | Warns when org pushes failed since the last success |
| `PostToolUse` (store/update/delete) | `sync-org-memory.sh` | For `org` memories: privacy filter, commit, push. Bursts are coalesced into one background sync |
| `PostToolUse` (`Write\|Edit\|MultiEdit`) | `architecture-change.sh` | After an `.adl` edit, asks the model to re-index and record the change |
| `PreCompact` | `extract-and-store-memories.sh` | See below |
| `SessionEnd` | `session-end.sh` | Flushes pending writes and commits the personal vault's local git repo |

### PreCompact capture

Before each context compaction (Claude Code; Gemini/Antigravity when the `claude` CLI is installed), `extract-and-store-memories.sh` sends the last 1 MiB of the session transcript to `claude -p` (your Claude Code login and default model, one call per compaction) and asks for 0–3 learnings as JSON lines. `store-learning.mjs` writes them to the personal vault and never overwrites a file. Each run appends one line to `~/.total-recall/.extract.log` (`outcome=wrote|nothing|dropped|cli-error|store-error`).

- **Saved:** what worked and what didn't, and project context that is not obvious from the code (motivations, constraints, decisions).
- **Not saved:** code, file paths, git history. All of it can be read from the workspace.

## 📝 Obsidian

Both vaults open as Obsidian vaults.

- Keep the YAML simple: flat string arrays and scalars. The parser does not support anchors or multi-line scalars.
- Edits made in Obsidian appear after a new session or `rebuild_index`.
- `[[wikilinks]]` are indexed as words; the link graph is not used.
- Do not use Obsidian Sync on the org vault: only total-recall's git sync runs the privacy filter.

## 📡 Design context

Several techniques from the [Thoughtworks Technology Radar Vol. 34](https://www.thoughtworks.com/radar) are used here: progressive context disclosure (only the index is injected), mutation testing (a Stryker gate in CI), plugin-marketplace distribution, structured output from the capture hook, and keeping system operations (git, indexing) in plain scripts rather than MCP tools. Future directions, each with the trigger that would start it, are in [BACKLOG.md](../BACKLOG.md).
