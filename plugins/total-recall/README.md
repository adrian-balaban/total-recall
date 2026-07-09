# Total Recall

Persistent knowledge management for Claude Code, GitHub Copilot CLI, and Gemini CLI. Stores memories as markdown files, exposes 12 MCP tools, and uses per-client lifecycle hooks to inject context automatically.

## What it is

A plugin that gives Claude, Copilot, and Gemini a persistent memory system. It runs as an MCP (Model Context Protocol) server — a stdio subprocess that the host client talks to via the MCP protocol. Memories are stored as markdown files on disk with YAML frontmatter, indexed in JSON for fast access.

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
- `store_memory` — create a memory; optional `force=true` overwrites (preserves `created`/`accessCount`). Refused if the existing memory is tagged `no-prune` (immortal), even with `force=true` — use `update_memory` to amend or `delete_memory(force=true)` then re-store

**Search & Recall** (`src/tools/recall.ts`)
- `recall_memory` — TF-IDF + Ebbinghaus decay, optionally fused with vector search via RRF
- `search_index` — metadata-only search (no file reads)

**Query** (`src/tools/query.ts`)
- `list_memories` — filtered listing by category/tag/date
- `get_memories_by_keys` — fetch by known key(s), with summary or full content
- `get_stats` — index statistics
- `get_timeline` — memories ordered by time
- `get_related_memories` — find memories related to a given one
- `prune_memories` — surface low-retention candidates (does NOT auto-delete); excludes memories tagged `no-prune`

**Mutate** (`src/tools/mutate.ts`)
- `update_memory` — edit existing memory; deduplicates session history (capped at 50)
- `delete_memory` — remove a memory; refuses memories tagged `no-prune` unless `force=true` is passed
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
- **Immortality (`no-prune` tag)** — a memory tagged `no-prune` is excluded from `prune_memories` candidates, refused by `delete_memory` unless `force=true` is passed, and refused by `store_memory` even with `force=true` (so a routine re-store can't silently rewrite an ADR's body or strip the tag). Use it for decisions that must never decay out of the candidate list or be removed by mistake (e.g. an ADR). Tag-only by design: the `decisions` category is NOT auto-protected, since not every decision is immortal — immortality is an explicit per-memory opt-in. Amend-in-place via `update_memory` (does not strip tags); deliberate teardown is `delete_memory(force=true)` then a fresh store
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

### Skills

Two Claude Code skills ship with the plugin (auto-discovered from `skills/`):

- **`memory-workflow`** — the retrieval-order protocol for the 12 MCP tools (check the injected index -> `get_memories_by_keys` -> `search_index` -> `recall_memory`), plus the write rules (executive summary, `importanceScore`, dedup before store).
- **`review-fix-ship`** — a closed review -> fix -> version-bump -> commit -> push loop for a git repository: review with `file:line` citations, apply all fixes, run the project's pre-commit checks, bump the version, commit, push, then repeat the pass until a full pass produces no changes (`git diff` empty).

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

The MCP server is a plain stdio Node process, so the same 12 tools work in **Claude Code**, **GitHub Copilot CLI**, and **Gemini CLI**. What differs per client is how the server and the lifecycle hooks get loaded. `install.sh` (at the plugin root) is the one-shot, state-aware setup script that creates the vault dirs, registers the MCP server, builds the index, and optionally wires hooks / enables the org vault and vector search. Every step checks current state first, so it's safe to re-run.

### Quick install by client

```bash
cd plugins/total-recall
npm install && npm run build      # build dist/ if not already present

# Claude Code (recommended) — plugin install auto-loads hooks/hooks.json + .mcp.json
claude plugin install "$(pwd)"

# GitHub Copilot CLI — registers MCP + hooks/hooks.copilot.json
./install.sh --copilot            # or directly: copilot plugin install "$(pwd)"

# Gemini CLI — copies to ~/.gemini/extensions/ and registers MCP + hooks/hooks.gemini.json
./install.sh --gemini             # or directly: gemini extensions install --consent "$(pwd)"

# Standalone (no plugin manager) — wires hooks into ~/.claude/settings.json with literal paths
./install.sh --standalone
./install.sh --help               # all flags
./install.sh -y --standalone --org-repo https://github.com/you/your-vault.git   # non-interactive
```

The skills (`/total-recall:memory-workflow`, `/total-recall:review-fix-ship`) are Claude Code-only — Copilot and Gemini get the 12 tools and the lifecycle hooks but not the skills.

Manual MCP registration (if not using the script or plugin):

```bash
claude mcp add-json total-recall '{"type":"stdio","command":"node","args":["'$(pwd)'/dist/index.js"]}'
```

For per-client compatibility details (what works, what degrades, manual MCP-only registration without hooks), see [Gemini compatibility](#gemini-compatibility) and [Copilot CLI compatibility](#copilot-cli-compatibility) below.

## Data Locations
 
| Location | Purpose |
|---|---|
| `~/.total-recall/personal-vault/` | Personal memory vault (default, configurable) |
| `~/.total-recall/org/org-vault/` | Shared org vault (default, configurable) |
| `~/.total-recall/index.json` | In-memory index (persisted) |
| `~/.total-recall/invertedIndex.json` | TF-IDF inverted index |
| `~/.total-recall/.index-cache.txt` | Shell-readable cache injected at SessionStart |
| `~/.total-recall/personal-vault/vectors.db` | sqlite-vec vector store (optional) |
| `~/.total-recall/config.json` | Plugin configuration |
 
## Configuration (`config.json`)
 
You can customize total-recall settings by creating or editing `~/.total-recall/config.json`. Supported settings:
 
```json
{
  "personalVault": "~/my-custom-personal-vault",
  "orgVault": "~/my-custom-org-vault",
  "orgRepo": "https://github.com/you/your-vault.git",
  "allowedEmailDomains": ["yourcompany.com"],
  "embeddingProvider": "ollama",
  "embeddingUrl": "http://127.0.0.1:11434/api/embeddings",
  "embeddingModel": "nomic-embed-text",
  "enableMultilingualSearch": true
}
```
 
### Configuration Parameters
 
- **Vault Locations**:
  - `personalVault` (string, optional): Custom absolute path (or starting with `~`) to override the default personal vault location.
  - `orgVault` (string, optional): Custom absolute path (or starting with `~`) to override the default org vault location.
 
- **Org Vault Sync**:
  - `orgRepo` (string, optional): Git HTTPS or SSH URL for the shared org vault repo.
  - `allowedEmailDomains` (array of strings, optional): Whitelisted email domains that can bypass the privacy filter (e.g. `["company.com"]`).
 
- **Embeddings Providers**:
  - `embeddingProvider` (string, optional): Choice of `'huggingface'` (default, in-process MiniLM), `'ollama'` (local API), or `'vertexai'` (Google Cloud Vertex AI).
  - `embeddingUrl` (string, optional): Endpoint for Ollama embeddings. Default: `http://127.0.0.1:11434/api/embeddings`.
  - `embeddingModel` (string, optional): Model name to request. Default for Ollama is `nomic-embed-text`, and for Vertex AI is `text-embedding-004`.
  - `embeddingApiKey` (string, optional): API authentication token for Vertex AI (if not using GCLOUD environment variables).
  - `vertexRegion` (string, optional): Region for Vertex AI API. Default: `us-central1`.
  - `vertexProjectId` (string, optional): GCP Project ID (required if using Vertex AI).
 
- **Bilingual & Multi-language Search**:
  - `enableMultilingualSearch` (boolean, optional): Set to `true` to enable automatic Romanian/English query token expansion for cross-language semantic retrieval in TF-IDF queries.
 
## Org Vault
 
Memories tagged `org` are synced to a shared git repo via `scripts/sync-org-memory.mjs`. Privacy filters block secret tokens and email addresses before any push. (Pronouns and phone numbers were intentionally removed — both had false-positive rates high enough to block legitimate org memories; the real "personal, don't sync" guard is the mutual-exclusion of the `personal` and `org` tags.)
 
The email filter is **fail-closed by default**: every email address is blocked from org sync. If your team legitimately syncs work contacts, allow your company domain in `~/.total-recall/config.json`:

```json
{ "orgRepo": "https://github.com/you/your-vault.git", "allowedEmailDomains": ["yourcompany.com"] }
```

Emails at any other domain remain blocked.

## Obsidian Integration

Both vaults are plain markdown-with-YAML-frontmatter folders, so they can be opened directly as Obsidian vaults — there's no plugin or API integration needed. Point Obsidian at `~/.total-recall/personal-vault/` and, separately, at `~/.total-recall/org/org-vault/` (as two vaults). Obsidian's own `.obsidian/` config folder is already excluded from vault scanning (`EXCLUDED_DIRS` in `src/paths.ts`), so it's never mistaken for memory content.

A few things to know before editing memories in Obsidian:

- **YAML is a subset, not identical.** `src/frontmatter.ts` is a minimal parser that supports inline arrays, quoted strings, and scalars, but not arbitrary YAML (no anchors, merge keys, or multi-line scalars). Anything total-recall writes is valid for Obsidian to read, but Obsidian's fancier Properties types (nested objects, folded scalars) won't round-trip cleanly through total-recall on the next write — stick to plain scalars and flat string arrays.
- **No live sync.** Files added or edited in Obsidian aren't picked up by total-recall until the next Claude Code session start (`reconcileIndex`) or a manual `rebuild_index` call — there's no file-watcher.
- **`[[wikilinks]]` are Obsidian-only.** They're a body-content feature Obsidian parses itself; total-recall's tokenizer strips brackets and indexes the plain words for TF-IDF, with no awareness of Obsidian's link graph. The two features are fully decoupled.
- **Don't double-sync the org vault.** It already syncs via `scripts/sync-org-memory.mjs` (git, with a privacy filter blocking secrets/emails before push). Enabling Obsidian Sync/Publish on the same folder adds a second, uncoordinated write path and bypasses that privacy filter — keep git as the only sync mechanism for the org vault, and use Obsidian Sync (if desired) only on the personal vault.

## What Happens Automatically

| Event | Action |
|---|---|
| Session start | Pull org vault, rebuild index cache, inject memory index + open questions into context |
| After store/update/delete | Sync to org vault (if tagged `org`), rebuild index cache |
| Before context compaction | Extract 0–3 learnings from transcript and store them |

## 12 MCP Tools

| Tool | Description |
|---|---|
| `store_memory` | Create a new memory (routes to org vault if tagged `org`). Throws on duplicate key — use `update_memory` or pass `force=true` to overwrite (preserves `created`/`accessCount`). `force=true` is refused if the existing memory is tagged `no-prune` (immortal). Org memories are always author-protected. |
| `recall_memory` | TF-IDF search with Ebbinghaus decay scoring |
| `list_memories` | Metadata-only listing with category/tag filter |
| `update_memory` | Update content, tags, or importance score |
| `delete_memory` | Remove from vault and index. Refuses memories tagged `no-prune` unless `force=true` is passed (immortal decisions, e.g. ADRs) |
| `rebuild_index` | Full re-scan of both vaults |
| `search_index` | Lightweight metadata-only search (no file reads) |
| `get_memories_by_keys` | Batch fetch; `summary=true` for executive summary only |
| `get_stats` | Totals, category breakdown, cache stats, performance percentiles |
| `get_timeline` | Chronological view with date grouping |
| `get_related_memories` | Jaccard tag similarity with same-category boost |
| `prune_memories` | Surface low-retention candidates (does NOT auto-delete). Excludes memories tagged `no-prune` (immortal, e.g. ADRs) |

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

## Other Clients

The MCP server is a plain stdio Node process and works in any client that speaks MCP. The hooks and skills are Claude Code-specific, but the project ships a Gemini-shaped parallel and a Copilot-shaped parallel (see below). Codex has no hook integration — the 12 tools work there, the automatic context injection does not.

## Gemini compatibility

**Short answer: the 12 MCP tools work; the hooks work IF you install the plugin as a Gemini extension; the skills are Claude Code-only.**

The plugin directory doubles as a Gemini CLI extension — `gemini-extension.json` registers the MCP server, and `hooks/hooks.gemini.json` wires the same lifecycle hooks (with Gemini's event-name renames). One `gemini extensions install <path>` does both.

| Component | Works in Gemini CLI? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | Plain stdio MCP server. Gemini CLI loads stdio MCP servers from `mcpServers` in `settings.json` (or `mcpServers` in `gemini-extension.json` when installed as an extension) and exposes their tools to the model. |
| **Hooks** (SessionStart/AfterTool/PreCompress/SessionEnd) | ✅ Yes, via `hooks/hooks.gemini.json` | Gemini renames the lifecycle events: `PostToolUse` → `AfterTool`, `PreCompact` → `PreCompress` (SessionStart/SessionEnd keep their names). The matcher regex targets the full MCP namespaced tool name (`mcp__total-recall__(store_memory\|update_memory\|delete_memory)`), not the bare suffix. `${extensionPath}` is substituted at load time. The script bodies are the same `hooks/scripts/*.sh` files Claude Code uses. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | Claude Code skills are invoked on demand via the `Skill` tool — the model picks the skill by name, the system loads the `SKILL.md` body as a one-shot knowledge injection, and the body references bare tool names (Claude Code adds the MCP namespace prefix at load time). Gemini has no equivalent: the closest analogs are (a) **custom slash commands** in `gemini-extension.json`, which are action invocations, not knowledge injections, and (b) a **`GEMINI.md` block**, which is always-on context, not on-demand. This plugin's skills are not authored for either, and there is no `activate_skill` tool on the Gemini side. |

### Installing as a Gemini extension (recommended)

`gemini extensions install` reads the `gemini-extension.json` manifest at the plugin root + `hooks/hooks.gemini.json` next to the existing `hooks/hooks.json`, copies the tree to `~/.gemini/extensions/total-recall/`, and registers the MCP server and hooks automatically. The `${extensionPath}` placeholder in the hooks file is resolved at load time, so the same source dir works on any machine.

```bash
cd plugins/total-recall && npm install && npm run build
gemini extensions install --consent "$(pwd)"
```

`--consent` skips the secondary "acknowledge the security risk" prompt; you'll still be asked to trust the folder once (a documented Gemini CLI requirement with no documented bypass). Verify with `gemini mcp list` (server listed) and by starting a Gemini session — the 12 tools appear namespaced as `mcp_total-recall_<tool>`.

`install.sh --gemini` does the same install in one step (and prints the exact `gemini extensions install` line if the script can't do it for you, e.g. under `-y`).

### Manual MCP-only registration (no hooks)

If you want just the 12 tools without the lifecycle hooks, add a stanza to `~/.gemini/settings.json` directly. Use an **absolute path** — Gemini does not expand `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "total-recall": {
      "command": "node",
      "args": ["/absolute/path/to/plugins/total-recall/dist/index.js"],
      "timeout": 30000
    }
  }
}
```

Or via the CLI command:

```bash
gemini mcp add -s user total-recall node /absolute/path/to/plugins/total-recall/dist/index.js
```

The 12 tools then appear namespaced as `mcp_total-recall_<tool>` — invoke them by asking in plain English ("recall X", "store memory", "list memories", etc.), same as in Claude Code.

### Gemini-specific notes

- **Server name:** keep `total-recall` (hyphen, not underscore). Gemini namespaces discovered tools as `mcp_{serverName}_{toolName}`, and underscores in the server name confuse its policy parser — `total-recall` is fine, `total_recall` is not.
- **Env-var sanitization:** Gemini CLI auto-redacts host env vars matching `*TOKEN*` / `*SECRET*` / `*PASSWORD*` / `*KEY*` unless you explicitly define them in the `env` block. total-recall reads its config from `~/.total-recall/config.json` (not env secrets), so this normally doesn't bite — but if you ever drive the org vault via a `GITHUB_TOKEN`-style env var, declare it explicitly in `env` or it will be stripped.
- **Matcher scope:** for `AfterTool` / `BeforeTool` the regex is matched against the **full MCP namespaced tool name** (`mcp__total-recall__store_memory`), not the bare suffix Claude Code uses. `hooks/hooks.gemini.json` already accounts for this; only relevant if you hand-author your own hook config.
- **`PreCompress` is advisory only:** Gemini explicitly says it "cannot block or modify the compression process." The hook still runs (and `transcript_path` is in stdin), so the learning-extraction script gets a chance — but Gemini may compress before the script finishes. Treat the PreCompress hook as best-effort.
- **Transport field:** Gemini uses `command` for stdio (as above). If copying a config from Claude Code that used `url` for an HTTP server, Gemini wants `httpUrl` instead — not relevant here since total-recall is stdio-only.

### What the Gemini hooks buy you

Same as Claude Code — full lifecycle parity:

- **SessionStart:** pull org vault, build the index cache, inject the memory index + open questions into context.
- **AfterTool** (matched on `store_memory|update_memory|delete_memory`): auto-sync the touched file to the org vault (privacy filter applies).
- **PreCompress:** extract 0–3 learnings from the transcript and store them (advisory, see above).
- **SessionEnd:** flush any pending writes.

Without the hooks (MCP-only install), the tools work but you lose all four: you'd call `search_index` / `recall_memory` / `list_memories` explicitly each session, and run `node scripts/sync-org-memory.mjs` by hand after every `org`-tagged store/update/delete.

For a unified client-comparison table and a consolidated per-client install-paths block, see [Copilot CLI compatibility](#copilot-cli-compatibility) below.

## Copilot CLI compatibility

**Short answer: the 12 MCP tools work; the hooks work IF you install the plugin as a Copilot extension (with one documented graceful degradation — `additionalContext` is silently lost, see below); the skills are Claude Code-only.**

Copilot's plugin loader accepts `.claude-plugin/plugin.json` as one of its four recognized manifest locations — the same file Claude Code reads. The new `"hooks": "hooks/hooks.copilot.json"` field points Copilot at a Copilot-shaped hooks file (different schema: `{"version": 1, "hooks": {...}}` instead of Claude's bare `{"hooks": {...}}`); the existing `mcpServers: "./.mcp.json"` (path-string) is already a documented Copilot-acceptable shape. One `copilot plugin install <path>` does both.

| Component | Works in Copilot CLI? | Why |
|---|---|---|
| **MCP server (12 tools)** | ✅ Yes | Plain stdio MCP server. Copilot loads stdio MCP servers from `mcpServers` in the plugin manifest and exposes their tools to the model. |
| **Hooks** (SessionStart/PostToolUse/PreCompact/SessionEnd) | ⚠️ Partial — side effects run, `additionalContext` is silently lost | `hooks/hooks.copilot.json` uses PascalCase event names, which makes Copilot deliver the **Claude-format (snake_case) stdin payload** — the existing script bodies parse it unchanged. The matcher regex targets the full MCP namespaced tool name (`mcp__total-recall__(store_memory\|update_memory\|delete_memory)`), not the bare suffix. **All side effects still run** — vault pull, index build, org-vault sync, PreCompact learning extraction, SessionEnd flush. The one thing lost is the LLM-facing `additionalContext` injection: Copilot's parser doesn't read the Claude envelope (`{"continue":true,"hookSpecificOutput":{...}}`) — for `SessionStart`/`PostToolUse` the `additionalContext` field is silently dropped, and for `PreCompact`/`SessionEnd` stdout is documented as not processed at all. The LLM in Copilot doesn't see the memory-index dump at session start; you can still call `search_index` / `recall_memory` / `list_memories` explicitly to find anything. |
| **Skill / slash command** (`/total-recall:memory-workflow`) | ❌ No | Claude Code skills are invoked on demand via the `Skill` tool — the model picks the skill by name, the system loads the `SKILL.md` body as a one-shot knowledge injection. Copilot has no `Skill`-equivalent tool, and the two Claude-specific skills are not authored for Copilot. The skills are Claude-Code-only. |

### Installing as a Copilot extension (recommended)

`copilot plugin install` reads `.claude-plugin/plugin.json` + `hooks/hooks.copilot.json` and registers the MCP server and hooks automatically. The `${PLUGIN_ROOT}` placeholder in the hooks file is resolved at load time, so the same source dir works on any machine.

```bash
cd plugins/total-recall && npm install && npm run build
copilot plugin install "$(pwd)"
```

Verify with `/mcp` inside a session or `copilot mcp list` from the shell. The 12 tools appear namespaced as `mcp__total-recall__<tool>`. The lifecycle hooks (vault pull, index build, org-vault sync) run automatically; `additionalContext` injection into the LLM context is silently lost (documented graceful degradation — the LLM just doesn't see the memory-index dump; the index is still built and the tools still work).

`install.sh --copilot` does the same install in one step (and prints the exact `copilot plugin install` line if the script can't do it for you, e.g. under `-y`).

### Manual MCP-only registration (no hooks)

If you want just the 12 tools without the lifecycle hooks, register the MCP server manually. Use an **absolute path** — Copilot doesn't expand `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "mcpServers": {
    "total-recall": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/plugins/total-recall/dist/index.js"]
    }
  }
}
```

The 12 tools then appear namespaced as `mcp__total-recall__<tool>` — invoke them by asking in plain English ("recall X", "store memory", "list memories", etc.), same as in Claude Code but without automatic index injection or org-vault auto-sync.

### Copilot-specific notes

- **`${PLUGIN_ROOT}` placeholder:** substituted by the Copilot plugin loader. Inside `.claude-plugin/plugin.json` the `${CLAUDE_PLUGIN_ROOT}` form is what Claude Code uses; Copilot uses `${PLUGIN_ROOT}`. The new `hooks/hooks.copilot.json` already uses `${PLUGIN_ROOT}`. Don't mix them.
- **Event-name casing triggers payload format:** PascalCase event names (`SessionStart`, `PostToolUse`, `PreCompact`, `SessionEnd`) make Copilot deliver the Claude-format (snake_case fields) stdin payload, AND the matcher uses Claude-format (full namespaced tool name) instead of native Copilot regex. This is the load-bearing reason `hooks/hooks.copilot.json` uses PascalCase everywhere.
- **Match in Claude format:** for `PostToolUse` (Claude-format) the regex is matched against the full namespaced tool name (`mcp__total-recall__store_memory`), not the bare suffix. `hooks/hooks.copilot.json` already accounts for this.
- **`preCompact` and `sessionEnd` are notification-only:** Copilot explicitly does not process the hook output for these events. The hooks still run (their side effects — learning extraction, write flush — still happen), but Copilot never injects anything back into the LLM context. Treat these as best-effort, same as Gemini's `PreCompress` advisory.
- **`claude -p` becomes a no-op on Copilot:** `extract-and-store-memories.sh` shells out to the `claude` CLI for the learning-extraction step. The `claude` binary is Claude-Code-specific, so on a Copilot machine the script tolerates a missing `claude` (per its own design) and the PreCompact hook becomes a no-op. This is the same caveat documented for the Gemini install.
- **`command` is the cross-platform hook field:** preferred over `bash`/`powershell` — Copilot auto-copies it to whichever platform-specific field is absent. `hooks/hooks.copilot.json` already uses `command`.

### What the Copilot hooks buy you

Same as Claude Code — full side-effect parity, only the LLM-facing `additionalContext` injection is lost:

- **SessionStart:** pull org vault, build the index cache (the on-disk `index.json` / `invertedIndex.json` are fresh for the tools to read).
- **PostToolUse** (matched on `store_memory|update_memory|delete_memory`): auto-sync the touched file to the org vault (privacy filter applies).
- **PreCompact:** extract 0–3 learnings from the transcript (advisory, see above — `claude -p` is a no-op on Copilot).
- **SessionEnd:** flush any pending writes.

Without the hooks (MCP-only install), the tools work but you lose all four: you'd call `search_index` / `recall_memory` / `list_memories` explicitly each session, and run `node scripts/sync-org-memory.mjs` by hand after every `org`-tagged store/update/delete.

### Per-client install paths

- **Claude Code (plugin install):** `claude plugin install …/plugins/total-recall` → reads `hooks/hooks.json` (uses `${CLAUDE_PLUGIN_ROOT}`) + `.mcp.json` automatically. No installer step needed.
- **Claude Code (standalone / uninstalled):** `./install.sh --standalone` → wires hooks into `~/.claude/settings.json` with literal absolute paths (since `${CLAUDE_PLUGIN_ROOT}` is plugin-context-only).
- **Gemini CLI:** `./install.sh --gemini` (or `gemini extensions install --consent <path>` directly) → copies the plugin dir to `~/.gemini/extensions/total-recall/`, registers the MCP server from `gemini-extension.json`, loads `hooks/hooks.gemini.json` with `${extensionPath}` substituted.
- **Copilot CLI:** `./install.sh --copilot` (or `copilot plugin install <path>` directly) → registers the MCP server from `.claude-plugin/plugin.json`, loads `hooks/hooks.copilot.json` with `${PLUGIN_ROOT}` substituted. Side-effect parity with Claude Code; `additionalContext` is silently lost (documented).

Same plugin directory, three distinct manifest pairs (Claude `.claude-plugin/plugin.json` + `hooks/hooks.json`, Gemini `gemini-extension.json` + `hooks/hooks.gemini.json`, Copilot `.claude-plugin/plugin.json` + `hooks/hooks.copilot.json`), one installer flag per client.

### Sources

- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference) — `plugin.json` schema, four recognized manifest locations, `mcpServers`/`hooks` field accepts path strings
- [GitHub Copilot hooks reference](https://github.com/github/docs/blob/main/content/copilot/reference/hooks-reference.md) — `version: 1` schema, event names, PascalCase→Claude-format, stdout envelope
- [GitHub Copilot hooks tutorial](https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks) — practical example of a hook file
- [GitHub Copilot plugin creating guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) — full plugin authoring flow

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
