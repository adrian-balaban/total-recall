# Total Recall

Persistent knowledge management for Claude Code. Stores memories as markdown files, exposes 12 MCP tools, and uses Claude Code hooks to inject context automatically.

## What it is

A Claude Code plugin that gives Claude a persistent memory system. It runs as an MCP (Model Context Protocol) server — a stdio subprocess that Claude Code talks to via the MCP protocol. Memories are stored as markdown files on disk with YAML frontmatter, indexed in JSON for fast access.

### Storage & Dual Vault Architecture

Two separate vaults live under `~/.total-recall/`:

| Vault | Path | When used |
|---|---|---|
| Personal | `~/.total-recall/personal-vault/` | Default for all memories |
| Org | `~/.total-recall/org/org-vault/` | When tagged `org` |

The org vault syncs to a remote git repo (`orgRepo` in `~/.total-recall/config.json`, branch `org-vault`) via a privacy filter that blocks secret tokens and email addresses before any push. (Pronouns and phone numbers were intentionally removed — both had false-positive rates high enough to block legitimate org memories; the real "personal, don't sync" guard is the mutual-exclusion of the `personal` and `org` tags.)

### The 12 MCP Tools

Grouped by function:

**Write** (`src/tools/store.ts`)
- `store_memory` — create a memory; optional `force=true` overwrites (preserves `created`/`accessCount`)

**Search & Recall** (`src/tools/recall.ts`)
- `recall_memory` — TF-IDF + Ebbinghaus decay, optionally fused with vector search via RRF
- `search_index` — metadata-only search (no file reads)

**Query** (`src/tools/query.ts`)
- `list_memories` — filtered listing by category/tag/date
- `get_memories_by_keys` — fetch by known key(s), with summary or full content
- `get_stats` — index statistics
- `get_timeline` — memories ordered by time
- `get_related_memories` — find memories related to a given one
- `prune_memories` — surface low-retention candidates (does NOT auto-delete)

**Mutate** (`src/tools/mutate.ts`)
- `update_memory` — edit existing memory; deduplicates session history (capped at 50)
- `delete_memory` — remove a memory
- `rebuild_index` — rescan vaults and rebuild all indexes (preserves access stats)

### Search Pipeline

```
recall_memory(query)
  -> TF-IDF (invertedIndex.json)           <- tokenizes title + tags + first ~500 chars
  -> Ebbinghaus decay multiplier           <- importance x exp(-lambda x days) x (1 + 0.2 x accessCount)
  -> [optional] vector embeddings          <- HuggingFace all-MiniLM-L6-v2 via sqlite-vec
  -> Reciprocal Rank Fusion (k=60)         <- fuses TF-IDF and vector rankings
  -> top-N results
```

The vector path requires optional deps (`@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`) and gracefully degrades to TF-IDF-only if they're absent.

### Key Algorithms

- **Ebbinghaus decay** (`src/ebbinghaus.ts`): `importance x exp(-lambda x days) x (1 + accessCount x 0.2)` — memories accessed frequently or recently rank higher
- **TF-IDF** (`src/tfidf.ts`): standard term-frequency / inverse-document-frequency over the in-memory inverted index
- **RRF** (`src/rrf.ts`): Reciprocal Rank Fusion merges two ranked lists without needing score normalization

### Data Flow & Performance

- On boot: loads `~/.total-recall/index.json` + `invertedIndex.json` into memory singletons (`src/state.ts`)
- All tool calls operate against the in-memory `memIndex` — no disk reads for metadata operations
- Debounced writes: mutations trigger `scheduleSave()` -> 1s later writes index -> `scheduleIdfRecalc()` -> +2s later rebuilds TF-IDF and writes `.index-cache.txt`
- LRU cache (`src/lru-cache.ts`): 100 entries, 30-min TTL — `recall_memory(full=true)` and `get_memories_by_keys` read through it; mutations invalidate entries

### Hooks (Automated Behaviors)

Three Claude Code lifecycle hooks in `hooks/hooks.json`:

| Hook | Trigger | Action |
|---|---|---|
| SessionStart | Session begins | Pull org vault -> rebuild cache -> inject memory index into context |
| PostToolUse | After store/update/delete | If tagged `org`, sync to org git repo |
| PreCompact | Before context compaction | Extract 0-3 learnings from transcript -> write as `.md` files to personal vault (never overwrites existing) |

### Module Map

```
src/index.ts          <- thin boot stub (signal handlers + main())
src/server.ts         <- MCP Server, 12 tool schemas, CallTool dispatch
src/state.ts          <- shared singletons (memIndex, invertedIndex, errors, perfSamples)
src/paths.ts          <- vault paths, EXCLUDED_DIRS, DEFAULT_CATEGORIES
src/types.ts          <- MemoryFrontmatter, MemoryMetadata, Index, InvertedIndex
src/lru-cache.ts      <- LRUCache + shared contentCache instance
src/persistence.ts    <- loadIndexes, scheduleSave/scheduleIdfRecalc, flushPending
src/tfidf.ts          <- tokenize, rebuildInvertedIndex, tfidfSearch
src/vault-scan.ts     <- reconcileIndex, indexFile, deriveCategory, slugify
src/frontmatter.ts    <- zero-dep YAML frontmatter parse/stringify (replaces gray-matter)
src/ebbinghaus.ts     <- retention strength formula
src/embeddings.ts     <- lazy HuggingFace pipeline loader
src/vectorStore.ts    <- sqlite-vec upsert/search/delete
src/rrf.ts            <- Reciprocal Rank Fusion
src/tools/{store,recall,query,mutate}.ts  <- 12 tool implementations
```

### Notable Design Decisions

- Frontmatter parser is custom (`src/frontmatter.ts`) — replaced gray-matter to avoid the js-yaml merge-key DoS vulnerability
- Author protection on org vault — `store_memory` and `update_memory` throw if the existing org memory's author differs from the current OS user
- `personal` + `org` tags are mutually exclusive — throws at write time
- Optional deps are truly optional — build externalizes HuggingFace, sqlite-vec, better-sqlite3, and fsevents; the server starts fine without them
- Tests run sequentially (`maxWorkers=1`) because all tests share the module-level state singletons


## Install

Installed as a Claude Code **plugin** (recommended), `hooks/hooks.json` and `.mcp.json` are auto-loaded — no manual MCP registration or hook wiring needed.

For a standalone or scripted setup, run **`install.sh`** (at the plugin root) — a one-shot, state-aware setup script that creates the vault dirs, registers the MCP server, builds the index, and optionally wires hooks / enables the org vault and vector search. Every step checks current state first, so it's safe to re-run:

```bash
cd plugins/total-recall
npm install && npm run build      # build dist/ if not already present
./install.sh                      # interactive
./install.sh --help               # all flags
./install.sh -y --standalone --org-repo https://github.com/you/your-vault.git   # non-interactive
```

Manual MCP registration (if not using the script or plugin):

```bash
claude mcp add-json total-recall '{"type":"stdio","command":"node","args":["'$(pwd)'/dist/index.js"]}'
```

## Data Locations

| Location | Purpose |
|---|---|
| `~/.total-recall/personal-vault/` | Personal memory vault |
| `~/.total-recall/org/org-vault/` | Shared org vault (git-synced) |
| `~/.total-recall/index.json` | In-memory index (persisted) |
| `~/.total-recall/invertedIndex.json` | TF-IDF inverted index |
| `~/.total-recall/.index-cache.txt` | Shell-readable cache injected at SessionStart |
| `~/.total-recall/personal-vault/vectors.db` | sqlite-vec vector store (optional) |
| `~/.total-recall/config.json` | Plugin configuration — `orgRepo`, `allowedEmailDomains` (optional) |

## Org Vault

Memories tagged `org` are synced to a shared git repo via `scripts/sync-org-memory.mjs`. Privacy filters block secret tokens and email addresses before any push. (Pronouns and phone numbers were intentionally removed — both had false-positive rates high enough to block legitimate org memories; the real "personal, don't sync" guard is the mutual-exclusion of the `personal` and `org` tags.)

The email filter is **fail-closed by default**: every email address is blocked from org sync. If your team legitimately syncs work contacts, allow your company domain in `~/.total-recall/config.json`:

```json
{ "orgRepo": "https://github.com/you/your-vault.git", "allowedEmailDomains": ["yourcompany.com"] }
```

Emails at any other domain remain blocked.

## What Happens Automatically

| Event | Action |
|---|---|
| Session start | Pull org vault, rebuild index cache, inject memory index + open questions into context |
| After store/update/delete | Sync to org vault (if tagged `org`), rebuild index cache |
| Before context compaction | Extract 0–3 learnings from transcript and store them |

## 12 MCP Tools

| Tool | Description |
|---|---|
| `store_memory` | Create a new memory (routes to org vault if tagged `org`). Throws on duplicate key — use `update_memory` or pass `force=true` to overwrite (preserves `created`/`accessCount`). Org memories are always author-protected. |
| `recall_memory` | TF-IDF search with Ebbinghaus decay scoring |
| `list_memories` | Metadata-only listing with category/tag filter |
| `update_memory` | Update content, tags, or importance score |
| `delete_memory` | Remove from vault and index |
| `rebuild_index` | Full re-scan of both vaults |
| `search_index` | Lightweight metadata-only search (no file reads) |
| `get_memories_by_keys` | Batch fetch; `summary=true` for executive summary only |
| `get_stats` | Totals, category breakdown, cache stats, performance percentiles |
| `get_timeline` | Chronological view with date grouping |
| `get_related_memories` | Jaccard tag similarity with same-category boost |
| `prune_memories` | Surface low-retention candidates (does NOT auto-delete) |

## Categories

`architecture` · `decisions` · `troubleshooting` · `meetings` · `knowledge` · `journal`

Categories are dynamic — derived from subdirectory names in the personal vault.

## Optional Vector Search

Install optional dependencies to enable hybrid TF-IDF + vector search:

```bash
npm install @huggingface/transformers sqlite-vec better-sqlite3
```

Uses `Xenova/all-MiniLM-L6-v2` (384-dim ONNX). Gracefully degrades to TF-IDF if not installed.

---

## Comparison with Similar Projects

Four implementations share the "total-recall" name or solve the same problem. Here's how they differ.

### Quick Identity

| | **This plugin** | [strvmarv/total-recall](https://github.com/strvmarv/total-recall) | [davegoldblatt/total-recall](https://github.com/davegoldblatt/total-recall) | [thedotmack/claude-mem](https://claudemarketplaces.com/plugins/thedotmack-claude-mem) |
|---|---|---|---|---|
| Problem solved | Persistent cross-session memory | Persistent cross-session memory | Persistent cross-session memory | Persistent cross-session memory |
| MCP server? | Yes — 12 tools | Yes — 41 tools | No | Yes — 3 tools |
| Language | TypeScript / Node.js | .NET 8 + F# | Bash + Markdown | TypeScript + Python |

### Storage & Search Architecture

| | **This plugin** | **strvmarv** | **davegoldblatt** | **thedotmack** |
|---|---|---|---|---|
| Storage | Markdown + JSON indexes | SQLite+sqlite-vec (local) or Postgres+pgvector (team) | Plain markdown only | SQLite FTS5 + Chroma |
| Vector search | Optional: sqlite-vec + HuggingFace MiniLM-L6-v2 (384d) | Built-in ONNX bge-small-en-v1.5 | None | Built-in Chroma |
| Text search | TF-IDF inverted index | BM25 | Claude reads files | FTS5 |
| Ranking | Ebbinghaus decay × TF-IDF, fused via RRF | 4-tier hot/warm/cold/pinned with BM25+cosine | None | None |
| Org/team sharing | Git-synced org vault with privacy filter | Postgres "Cortex" + Jira/Confluence/GitHub connectors | No | No |

### Claude Code Integration

| | **This plugin** | **strvmarv** | **davegoldblatt** | **thedotmack** |
|---|---|---|---|---|
| Hooks | SessionStart, PostToolUse, PreCompact | UserPromptSubmit | SessionStart, PreCompact | 5-stage pipeline |
| Skills | 2 (memory-workflow, review-fix-ship) + `install.sh` setup script | Auto-discovered | 10 slash commands | 1 (mem-search) |
| Auto-capture | LLM extracts 0–3 learnings at PreCompact | Compaction + decay | PreCompact timestamp only | Captures everything automatically |
| Token injection | Memory index + open questions at SessionStart | Pinned tier (always) + Hot tier (4 000-token budget) | CLAUDE.local.md (~1 500 words) | Filtered search results |

### What Makes Each Unique

**This plugin** — Ebbinghaus forgetting curve (`importance × e^(−λ×days) × access boost`) for time-aware decay; dual vault with privacy filter before org sync; hybrid TF-IDF + vector RRF fusion with graceful degradation; smallest dependency footprint among MCP implementations.

**strvmarv/total-recall** — Most feature-complete: 41 tools, embedded React web UI, token cost estimation, retrieval benchmarking, team Cortex with enterprise connectors. Self-contained .NET NativeAOT binary (no Node runtime). Designed for team deployments.

**davegoldblatt/total-recall** — Zero-dependency pure markdown/bash. 5-criteria write gate prevents junk accumulation. `[superseded]` corrections preserve history without deletion. No semantic search; relies on Claude reading files. Best choice if you want no runtime or infrastructure.

**thedotmack/claude-mem** — Most automatic: 5-stage hook pipeline captures everything, AI-compresses, no manual `store_memory` calls needed. `<private>` tag excludes sensitive content. 3-layer token-efficient retrieval. Requires a running background worker on port 37777 + Chroma — heavier operational footprint.
