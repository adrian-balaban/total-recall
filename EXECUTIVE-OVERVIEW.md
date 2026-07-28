# Total Recall — Executive Overview

## One-line summary
A persistent memory MCP server shipped as a Claude Code / Gemini CLI plugin, giving the agent a file-backed, searchable knowledge base that survives across sessions.

## What it is
Total Recall is a stdio MCP server (version 1.0.135) that exposes 17 tools for persistent memory management. Memories are stored as YAML-frontmatter + markdown files on disk across two vaults: a personal vault (`~/.total-recall/personal-vault`) and a shared, git-synced org vault (`~/.total-recall/org/org-vault`). Retrieval uses TF-IDF search weighted by an Ebbinghaus forgetting-curve decay model, optionally fused with in-process HuggingFace MiniLM-L6 vector embeddings via Reciprocal Rank Fusion (k=60).

## What it does
- Stores memories as markdown files with frontmatter (title, tags, category, importanceScore, sessions, supersede chain).
- Recalls memories via TF-IDF (sublinear TF, sqrt length norm, title/tag boost) with optional hybrid vector search.
- Ranks results by Ebbinghaus retention strength: `importance × exp(-λ×days) × (1 + access×0.2 + confirmations×0.1 − flags×0.1)`.
- Routes memories to personal or org vault via mutually-exclusive `org`/`personal` tags; org writes are author-locked to the OS user.
- Syncs org-tagged memories to a shared git branch through a fail-closed privacy filter (Luhn credit cards, mod-97 IBANs, formatted phones, high-entropy/labeled secrets, non-allowlisted emails).
- Auto-journals personal `store_memory` events to a dated `journal/<YYYY-MM-DD>.md`.
- Implements Graphiti-style supersede archiving on `store_memory` force=true (prior body → `.superseded/<cat>/<slug>.<ts>.md`).
- Provides an opt-in `no-prune` immortality tag refused by store/delete/prune.
- Injects a memory index into Claude's context at SessionStart via hooks (the headline "free retrieval" feature).
- Auto-extracts 0-3 learnings from the transcript on PreCompact and writes them to the personal vault.
- Bundles two skills: `memory-workflow` (retrieval/capture guide) and `review-fix-ship` (iterative hardening loop).
- Ships a state-aware `install.sh` with Minimal (TF-IDF only) and Complete (hybrid vector) profiles, optional statusline, Gemini extension, and org-vault setup.
- Reconciles disk state into an in-memory index at boot and on a 10s marker poll so org-vault git pulls surface without restart.
- Flushes pending writes and in-flight embeddings on SIGTERM/SIGINT/stdin-end via a latched shutdown.

## The 17 MCP tools
Grouped by module:

- **Write (1):** `store_memory`
- **Search/Recall (2):** `recall_memory`, `search_index`
- **Query/Read (6):** `list_memories`, `get_memories_by_keys`, `get_stats`, `get_timeline`, `get_related_memories`, `prune_memories`
- **Mutate (4):** `update_memory`, `delete_memory`, `confirm_memory`, `rebuild_index`
- **Rerank (1):** `rerank_memories`
- **Bulk (3):** `export_memories`, `import_memories`, `delete_memories`

## How it works
Each memory is a markdown file with YAML frontmatter. At boot the server walks both vaults (skipping symlinks, EXCLUDED_DIRS, and the personal `org/` subtree), builds an in-memory `memIndex: Record<key, MemoryMetadata>`, and synchronously rebuilds an inverted index + IDF cache before accepting queries. TF-IDF search runs over title + tags + contentPreview with sublinear TF and per-doc Ebbinghaus decay applied once. When the optional HuggingFace + sqlite-vec + better-sqlite3 deps are present, `recall_memory` fuses TF-IDF and vector nearest-neighbor ranks via Reciprocal Rank Fusion (k=60); on any vector-path failure it degrades to TF-IDF-only and records the error to `get_stats`. Writes debounce 1s (index.json) + 2s (inverted index + cache) and are flushed atomically (random-tmp + fsync + rename). A 10s background poller watches a marker file so an external org-vault git pull triggers reconciliation without restart.

## Architecture in one paragraph
A single stdio MCP server (`dist/index.js`, launched via `.mcp.json` as `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js`) constructed with the high-level McpServer API; six per-module `register(server)` functions wire the 17 tools through a shared `wrapHandler` envelope (Zod safeParse boundary, JSON-stringified success, `isError:true` + `recordError` on throw, `recordPerfSample` timing). Shared in-memory singletons (`memIndex`, `invertedIndex`, bounded `errors`/`perfSamples`) live in `state.ts`. The persistence layer (`persistence.ts`) owns atomic writes, the dirtyTokens gate that stops reads from rebuilding the inverted index, and the filePath-from-key containment check that blocks a poisoned `index.json` from arming arbitrary read/delete. The vault scanner (`vault-scan.ts`) bridges disk and memory with symlink/lstat guards and mtime+size skip for boot performance. Claude Code hooks (`hooks/hooks.json`) wire SessionStart index injection, PostToolUse org-sync, PreCompact learning extraction, and SessionEnd flush; equivalent Gemini wiring lives in `hooks/hooks.gemini.json`.

## Dependencies & footprint
- **Production dependencies (2):** `@modelcontextprotocol/sdk ^1.0.0`, `zod ^4.4.3`.
- **Optional dependencies (3, lazy-loaded, graceful degrade to TF-IDF):** `@huggingface/transformers ^3.8.1` (~200MB MiniLM model), `better-sqlite3 ^12.10.0` (native binding, self-heals via in-process npm rebuild), `sqlite-vec ^0.1.9`.
- **Dev dependencies (8, not in shipped runtime):** esbuild, typescript, tsx, vitest, @vitest/coverage-v8, fast-check, @stryker-mutator/core + typescript-checker + vitest-runner.
- **node_modules size:** ~976 MB (279 entries) — install cache, gitignored, regenerated by `npm install`.
- **dist/ size:** ~1.2 MB (3 files: `index.js`, `frontmatter.mjs`, `privacy-filter.mjs`) — the runtime bundle, git-tracked (committed for git-subdir marketplace distribution; no publish-time build step exists).
- **Engine:** Node >= 18. ESM.

## Maturity
- **Tests:** ~12,346 lines across 41 test files; three-tier suite (unit/component, integration, e2e).
- **Coverage thresholds:** v8 coverage at 95% lines/functions/statements, 90% branches over `src/**/*.ts`.
- **Integration suite:** spawns built `dist/index.js` over stdio with the real MCP Client; pins JSON-RPC wire format, Zod dispatch boundary, tools/list schema parity against a golden snapshot, and SIGTERM shutdown flush.
- **Mutation testing:** Stryker 9.6 with vitest runner, `coverageAnalysis=perTest`, `ignoreStatic=true`, mutating 16 source modules; thresholds high=80/low=65/break=65. Dev-only quality gate, not on the pre-commit critical path.
- **Pre-commit gate (no CI):** the repo's CLAUDE.md mandates bump version → build → `npm test` → `npm run typecheck` before every source-touching commit, because the plugin ships via git-subdir with no CI between commit and `claude plugin update`.
- **Version:** 1.0.135 (single-sourced from `package.json`, propagated to `.claude-plugin/plugin.json` and `gemini-extension.json` via `scripts/sync-version.mjs` at build time, injected into the bundle as `__PLUGIN_VERSION__`).

## Where it runs
- **Claude Code plugin:** registered via `.mcp.json` as a single stdio server `total-recall` → `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js`; hooks auto-loaded from `hooks/hooks.json` when installed via the plugin manager, or wired into `~/.claude/settings.json` for `install.sh --standandalone`.
- **Gemini CLI extension:** registered via `gemini-extension.json` → `node ${extensionPath}/dist/index.js`; hooks from `hooks/hooks.gemini.json` (event names AfterTool/PreCompress).
- **Installer:** `install.sh` stands up vault dirs, MCP registration, the initial index build, and optional hooks/statusline/Gemini/org-vault/vector-deps. Profiles: Minimal (TF-IDF only) vs Complete (default, hybrid vector ~200MB).
- **OS support:** any POSIX sh + Node 18+; Windows only via Git Bash (MSYS/MINGW/Cygwin detected, `flock` caveat flagged).