# 🧠 Total Recall

Persistent knowledge and memory management for Claude Code, GitHub Copilot CLI, and Gemini CLI.

Stores memories locally as Markdown files with YAML frontmatter, indexes them for fast hybrid search (TF-IDF × Ebbinghaus forgetting curve, optionally fused with vector embeddings), and uses per-client lifecycle hooks to inject relevant context automatically at session start.

> **Installation:** see [INSTALL.md](INSTALL.md) — profiles (minimal / complete, complete is the default), per-client setup, Windows notes, org vault.
> **Internals:** see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 😵 The Problem

At the end of every conversation, an AI coding assistant loses all accumulated context. Decisions, preferences, discussed architectures — gone. You re-explain the same project details session after session; feedback you gave the model never persists; architecture decisions accumulate nowhere.

**Total Recall** gives the model a persistent, searchable memory between sessions:

- **What it is:** an MCP server with 17 tools + automatic lifecycle hooks + a vault of plain Markdown files under `~/.total-recall/`.
- **What it is not:** it does not send data to the cloud (the personal vault is fully local), does not use an opaque database (every memory is a readable `.md` file you can git-version and open in Obsidian), and does not replace context — it injects into it.

---

## 💾 Architecture & Storage

Two separate vaults live under `~/.total-recall/`:

| Vault | Path | When Used |
|---|---|---|
| **Personal** | `~/.total-recall/personal-vault/` | Default for all memories (stays local). |
| **Org** | `~/.total-recall/org/org-vault/` | Used when tagged `org`. Syncs to a remote Git repo with a privacy filter. |

### On-disk layout

```
~/.total-recall/
├── index.json               ← flat index: key → MemoryMetadata
├── invertedIndex.json       ← TF-IDF inverted index: token → {docs, idf}
├── .index-cache.txt         ← summary injected at SessionStart (shell-readable)
├── config.json              ← optional configuration (see below)
├── personal-vault/
│   ├── architecture/
│   │   └── db-choice.md     ← one memory: YAML frontmatter + Markdown body
│   ├── decisions/ …
│   └── vectors.db           ← sqlite-vec embeddings (optional)
└── org/
    └── org-vault/           ← team memories, git-synced (branch org-vault)
```

Each memory is a `.md` file:

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

### Design philosophy: own algorithms, one hard dependency

The only mandatory dependency is `@modelcontextprotocol/sdk`. TF-IDF, Ebbinghaus decay, RRF, and the YAML-frontmatter parser are all written from scratch. Why:

1. **Security** — no `gray-matter` → no `js-yaml` CVE class (GHSA-h67p-54hq-rp68); the minimal parser is pinned by property-based tests (fast-check).
2. **Coherent scoring** — title-boost, tag-boost, and decay are one formula, not three libraries.
3. **Determinism** — zero LLM calls in the search path, zero cost, works offline/air-gapped.
4. **Auditability** — every scoring decision is observable via `get_stats`.

Only ONNX (`@huggingface/transformers`) and `sqlite-vec` remain external — and both are optional.

### Privacy Filter & Org Sync

*   **Fail-closed by default**: blocks high-entropy secret tokens/keys, labeled secrets (e.g. a pasted `aws_secret_access_key = …`), and all email addresses before any git push. If the filter cannot analyze the content, it does **not** push.
*   **Email whitelist**: allow specific domains via `allowedEmailDomains: ["yourcompany.com"]` in `config.json`.
*   **Author protection**: org memories can only be overwritten/updated by their author (OS username).
*   *Note: pronouns and phone numbers are deliberately allowed (false-positive rate blocked legitimate work notes); the `personal` and `org` tags are mutually exclusive to prevent accidental sync.*

---

## 🛠️ 17 MCP Tools

All tool calls operate against an in-memory index (`index.json`), making read/search operations extremely fast and free of disk I/O. Speak naturally — *"remember that…"* / *"remind me…"* — and the model picks the right tool.

| Tool | Function | Notable Behavior |
|---|---|---|
| `store_memory` | Create a memory | Routes to Org vault if tagged `org`. Overwrite needs `force=true` (refused on `no-prune` files). |
| `update_memory` | Edit a memory | Preserves created timestamp and appends to session history (capped at 50). Re-embeds on content/tags/importance change. |
| `delete_memory` | Delete a memory | Refuses `no-prune` memories unless `force=true` is passed. |
| `rebuild_index` | Rescan filesystem | Full re-scan of vaults, rebuilding TF-IDF while preserving access stats. |
| `recall_memory` | Hybrid search | TF-IDF, Ebbinghaus decay, and optional vector embeddings (fused via RRF). |
| `search_index` | Metadata search | Fast query scan of the in-memory index; does not read files, no accessCount bump. |
| `list_memories` | Browse vault | Paginated listing of memory metadata (filter by tag/category/date). |
| `get_memories_by_keys` | Fetch memory | Batch fetch by key; full content or summary; served through an LRU cache. |
| `get_stats` | Audit plugin | Totals, cache stats, recent error log (last 10), latency percentiles. |
| `get_timeline` | Chronological view | Memories grouped and sorted by modification dates. |
| `get_related_memories` | Find relations | Jaccard similarity of tags with a category boost. |
| `prune_memories` | Clean stale entries | Lists Ebbinghaus decay candidates (does not auto-delete). Excludes `no-prune`. |
| `rerank_memories` | Semantic rerank | Reorders candidate keys by cosine similarity to a query using embeddings. |
| `export_memories` | Bulk export | Portable JSON archive; filter by keys, category, or tag. Closes the "new laptop" scenario. |
| `import_memories` | Bulk import | Restores from an `export_memories` archive; skips existing keys unless `force=true`. |
| `delete_memories` | Bulk delete | Deletes a list of keys; requires `confirm=true`; respects `no-prune`. Closes the `prune_memories` loop. |
| `confirm_memory` | Feedback signal | `useful=true` increments confirmations; `useful=false` increments flags — both feed retention scoring. |

---

## 🔍 Search Pipeline

```
recall_memory(query)
  │
  ├─ tfidfSearch(query)
  │    ├─ tokenize(query) → tokens (EN↔RO expansion if enableMultilingualSearch)
  │    ├─ per token: lookup in invertedIndex
  │    ├─ score = TF × IDF × title-boost(2×) × tag-boost(1.5×)
  │    └─ × computeRetentionStrength(importance, daysSince, accessCount, confirmations, flags)
  │
  ├─ [optional: vector deps installed]
  │    ├─ embed(query) → sqlite-vec KNN
  │    └─ Reciprocal Rank Fusion(tfidf, vector), k=60:  score(d) = Σ 1/(60 + rank_i(d))
  │
  └─ slice to `limit`, bump accessCount, return with/without full content
```

> **What is TF-IDF?** Term Frequency × Inverse Document Frequency — the classic text-search score: a word counts a lot if it appears **often in this document** (TF) but **rarely across the collection** (IDF). The *inverted index* is the reverse map `word → documents containing it`, like a book index — search reads the index, never the files.

### The Ebbinghaus forgetting curve (1885), in code

Memories fade like human memory: unimportant, unaccessed memories decay out of results; every access "refreshes" them.

```
λ        = 0.16 × (1 − importanceScore × 0.8)
strength = clamp(importance × exp(−λ × daysSince)
                 × (1 + accessCount × 0.2 + confirmations × 0.1 − flags × 0.1), 0, 1)
```

| importanceScore | λ (forgetting speed) | Behavior |
|---|---|---|
| 1.0 (critical) | 0.032 | Slow decay — relevant for weeks |
| 0.5 (normal) | 0.096 | Medium decay |
| 0.3 (low) | 0.122 | Fast decay — fades from results in days |

Each access adds +20% retention; each `confirm_memory(useful=true)` +10%; each flag −10% — so a frequently accessed memory that was flagged wrong today drops, refining retention beyond raw access counts (an idea validated by [mozilla-ai/cq](https://github.com/mozilla-ai/cq)'s endorsement signal).

*   **Immortality (`no-prune` tag)**: excludes the memory from `prune_memories` and protects it from accidental deletion or routine overwrite. Useful for architecture decisions (ADRs).

### Embeddings & vector search (optional)

Optional, lazy-loaded, fully local — the plugin degrades cleanly to TF-IDF without the native deps (offline machines, failed native builds). No cloud APIs, no API keys; vectors are computed once at write time (`vectors.db`), never re-embedded on read; heavy deps are esbuild-`external` so the base bundle stays tiny; `flushPending()` on SIGTERM/SIGINT guarantees vectors hit disk on exit.

```bash
npm install --no-save @huggingface/transformers sqlite-vec better-sqlite3   # or install.sh --complete
```

Why hybrid: TF-IDF is exact-token ("k8s pod OOM" misses "workload killed for memory pressure"); the embedding model handles paraphrase — and with `bge-m3` via Ollama (1024-dim, multilingual) it also matches **cross-language** (store in Romanian, retrieve in English). `all-MiniLM-L6-v2` via HuggingFace (384-dim) covers English paraphrase only. RRF fuses the two rankings by position only (scale-free), since lexical scores and cosine similarities aren't directly comparable.

### Multilingual search (EN↔RO)

`enableMultilingualSearch: true` expands query tokens between English and Romanian:

```
# 1. Store (in English):
> "remember that we chose PostgreSQL over MySQL because of JSONB support"

# 2. In a new session, ask in ROMANIAN:
> "care a fost decizia noastră despre baza de date?"
→ recall_memory(query="decizie baza de date")
→ expansion maps „decizie"→"decision", „baza de date"→"database" → finds the English memory ✅
```

---

## 🪝 Lifecycle Hooks

> Before context compaction (`PreCompact`), the plugin **automatically saves the session's learnings** — knowledge survives even when the context is wiped.

### `SessionStart` (4 sequential steps)

```
1. pull-org-vault.sh       — git pull on the org-vault branch (if configured)
2. build-memory-index.sh   — frontmatter scan → .index-cache.txt
3. load-memory-index.sh    — inject the memory index into context (Claude Code only)
4. load-open-questions.sh  — inject open-questions.md into context (Claude Code only)
```

Effect: every new Claude session automatically receives a summary of all your memories — without asking.

### `PostToolUse` (matcher: `store_memory|update_memory|delete_memory`)

`sync-org-memory.sh` — checks the `org` tag, applies the privacy filter, commits/pushes to the team's `org-vault` branch, and rebuilds `.index-cache.txt`. Bursts of org writes are **coalesced**: an atomic job queue + `flock`ed background worker means one git sync process per session, not one per key. Pulled teammate memories are reconciled into the live index **without a restart** (marker-file poller).

### `PreCompact`

`extract-and-store-memories.sh` — reads the session transcript, asks the model to extract 0–3 key learnings as JSON lines, and `store-learning.mjs` writes them directly as `.md` files to the personal vault (no MCP round-trip; never overwrites existing files).

### `SessionEnd`

Logs the session and flushes pending embedding writes before exit.

---

## 📇 Retrieval order (cheapest first)

1. Injected index at SessionStart (free — already in context)
2. `get_memories_by_keys(summary=true)` — if you know the key
3. `search_index(query=…)` — fast metadata, no file reads
4. `recall_memory(query=…, full=false)` — TF-IDF + Ebbinghaus
5. `recall_memory(query=…, full=true)` — with full content

The bundled `/total-recall:memory-workflow` skill teaches the model this order plus capture rules (executive summary, dedup check, importanceScore).

---

## ⚙️ Configuration (`config.json`)

Configure total-recall by editing `~/.total-recall/config.json`:

```json
{
  "personalVault": "~/my-custom-personal-vault",
  "orgVault": "~/my-custom-org-vault",
  "orgRepo": "https://github.com/you/your-vault.git",
  "allowedEmailDomains": ["yourcompany.com"],
  "embeddingProvider": "ollama",
  "embeddingModel": "bge-m3",
  "embeddingTimeoutMs": 5000,
  "enableMultilingualSearch": true
}
```

*   **embeddingProvider**: `'huggingface'` (local MiniLM) or `'ollama'` (local API). `install.sh` auto-selects `ollama` when Ollama is on PATH with the `bge-m3` model pulled, else `huggingface`; an existing explicit value is never overwritten.
*   **embeddingModel**: used only for external providers (Ollama defaults to `bge-m3`).
*   **embeddingTimeoutMs**: per-attempt cap on Ollama embedding requests (default `5000`). Each embed makes at most 2 bounded attempts (one retry after a 200 ms backoff) — absorbs the transient HTTP 500s Ollama returns while loading/evicting another model, without stalling on a genuinely-down daemon. `embed()` is awaited on the hybrid-recall read path, so the default is tuned for read latency (~10.2s worst case before TF-IDF fallback); a session circuit breaker (3 consecutive failures → 60s cooldown) caps the repeated-hit case so a down Ollama doesn't stall every recall.
*   **enableMultilingualSearch**: Romanian/English query token expansion for cross-language lexical retrieval.

---

## 🚀 Installation

See **[INSTALL.md](INSTALL.md)** for the full guide (profiles, Windows, org vault, Codex). TL;DR:

```bash
cd plugins/total-recall && npm install && npm run build

claude plugin install "$(pwd)"       # Claude Code
./install.sh --gemini                # Gemini CLI
./install.sh --standalone            # Standalone (~/.claude/settings.json)
./install.sh --copilot               # GitHub Copilot CLI
```

`install.sh` asks up front: **a. default** (no optional deps, no local LLM) or **b. complete** (vector search + local embeddings).

---

## 💻 Client Compatibility

| Client | MCP Tools | Hook Side Effects (Sync/Index) | Context Injection (`additionalContext`) | Playbook Skills |
|---|---|---|---|---|
| **Claude Code** | ✅ Yes | ✅ Yes | ✅ Yes (SessionStart/PostToolUse) | ✅ Yes |
| **Gemini CLI** | ✅ Yes | ✅ Yes | ❌ No (silently dropped by Gemini) | ❌ No |
| **Copilot CLI** | ✅ Yes | ✅ Yes | ❌ No (silently dropped by Copilot) | ❌ No |
| **Codex CLI** | ✅ Yes | ❌ No | ❌ No | ❌ No |

### Client-Specific Integration Details

*   **Claude Code**: zero-touch. Hooks automatically pull git changes, rebuild the local cache, and inject memories at session start.
*   **Gemini CLI**: registers through `gemini-extension.json`. Tool namespace is `mcp_total-recall_<tool>` (single underscore); Gemini renames the hook events (PostToolUse→AfterTool, PreCompact→PreCompress) — handled by `hooks/hooks.gemini.json`.
*   **Copilot CLI**: configured via `hooks/hooks.copilot.json`. Tool namespace is `mcp__total-recall__<tool>` (double underscores). `additionalContext` is dropped by the client, but the background side effects (git sync, index builds) run normally — a documented graceful degradation.
*   **Codex CLI**: MCP server only (no hooks) — see [INSTALL.md](INSTALL.md#codex-cli-mcp-only-no-hooks).
*   **Ollama backends**: total-recall works as persistent memory for `ollama launch claude` too — same vault regardless of whether Claude Code talks to Anthropic or a local model.
*   **Windows**: supported via Git Bash — keys and git paths are `/`-normalized internally; see [INSTALL.md](INSTALL.md#windows).

---

## 📝 [Obsidian](https://obsidian.md/) Integration

Both vaults open directly as Obsidian vaults (plain `.md` + YAML frontmatter).

*   **Simple YAML**: stick to flat string arrays and simple scalars. `src/frontmatter.ts` does not support anchors or multi-line block scalars.
*   **No file watching**: Obsidian edits are not loaded until a new session starts or you call `rebuild_index`.
*   **Wiki-links**: `[[wikilinks]]` are tokenized by their raw words; the link graph is not resolved.
*   **Sync safeguard**: do not use Obsidian Sync on the org-vault directory; rely exclusively on total-recall's git sync so the privacy filter runs before every push.

---

## 💡 Inspiration & Comparison with Similar Projects

Projects and ideas this plugin drew on:

*   **[strvmarv/total-recall](https://github.com/strvmarv/total-recall)** and **[davegoldblatt/total-recall](https://github.com/davegoldblatt/total-recall)** — same name, different trade-offs (see table below); studying them shaped the "bounded local memory, plain files" positioning.
*   **Hermann Ebbinghaus (1885)** — the forgetting curve `e^(−t/S)` behind retention scoring.
*   **Reciprocal Rank Fusion** (Cormack, Clarke & Buettcher, 2009) — the scale-free rank fusion (k=60) used for the hybrid lexical+vector merge.
*   **[Obsidian](https://obsidian.md/)** — the "your knowledge is a folder of Markdown files with frontmatter" storage model.
*   **[mozilla-ai/cq](https://github.com/mozilla-ai/cq)** — the open standard for *shared agent learning*. Complementary, not competing: cq = operational lessons shared between agents via a reviewed store; total-recall = *your* context memory (decisions, preferences, architecture) as `.md` files + git, no server, no review pipeline. cq's endorsement mechanism directly inspired total-recall's `confirm_memory` confirmations/flags signal in the retention score.

| | This Plugin | [strvmarv/total-recall](https://github.com/strvmarv/total-recall) | [davegoldblatt/total-recall](https://github.com/davegoldblatt/total-recall) | [mozilla-ai/cq](https://github.com/mozilla-ai/cq) |
|---|---|---|---|---|
| **Language** | TypeScript / Node.js | .NET 8 + F# | Bash + Markdown | Python |
| **Storage** | Markdown + JSON index | SQLite / Postgres | Markdown | Shared knowledge store |
| **Text Search** | TF-IDF | BM25 | Plain files scan | — |
| **Vector Search** | Optional sqlite-vec | Local ONNX | None | — |
| **Rerank/Decay** | Ebbinghaus decay × TF-IDF + confirm/flag signals | 4-tier hot/warm/cold | None | Human review + endorsements |
| **Org Sync** | Git-synced, privacy filter | DB connectors (Jira, Confluence) | None | Reviewed shared store (7 hosts) |
| **Context injection** | ✅ Native (Claude Code hooks) | — | — | ❌ agent must query explicitly |
| **Target** | Bounded local memory | Large team deployments | Zero dependencies | Cross-agent shared learning |
