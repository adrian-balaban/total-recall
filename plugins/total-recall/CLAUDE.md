# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Bundle src/index.ts → dist/index.js (esbuild, CJS)
npm run build:watch    # Same, with watch mode
npm run dev            # Run via tsx without building (dev only)
npm run typecheck      # tsc --noEmit
npm test               # vitest run — unit + component tests (excludes integration)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest run --coverage (95% line/fn/stmt, 90% branch thresholds)
npm run test:integration  # build then vitest run --config vitest.integration.config.ts
                         # spawns real dist/index.js over stdio (slow, needs build)
npx vitest run src/__tests__/ebbinghaus.test.ts  # run a single test file
```

Tests run sequentially (maxWorkers=1) because the server has module-level state (the shared singletons in `src/state.ts`).

## Install / setup

`install.sh` (plugin root) is the one-shot, state-aware setup script: vault dirs → MCP registration → index build → optional standalone hook wiring / org vault / vector search → verify. Run `./install.sh --help` for flags (`-y`, `--standalone`, `--org-repo`, `--allowed-email-domain`, `--vector`/`--no-vector`). Its `--standalone` step embeds the canonical hooks JSON inline — keep that block in sync with `hooks/hooks.json` if hook commands, timeouts, or the build→load ordering change.

## Build artifacts (`dist/`)

`dist/` is **intentionally committed to git**. The plugin is distributed via `git-subdir` in the marketplace, so consumers need the built artifacts without running `npm run build` themselves. Always run `npm run build` before committing to ensure `dist/` stays in sync with source.

## Before committing — mandatory pre-commit checklist

Run all three, in order, **before every commit** that touches source or the plugin manifest (not just releases). The plugin is distributed via `git-subdir`, so a committed-but-untested change ships to consumers on `claude plugin update` with no CI gate in between.

1. **Increase the version.** Bump the version in **`package.json` only** — it is the single source of truth. Do **not** edit `.claude-plugin/plugin.json`'s version by hand: the `npm run build` step (below) runs `sync:version` (`scripts/sync-version.mjs`), which copies `package.json`'s version into `plugin.json` automatically, so the two can never drift. `claude plugin update` only picks up the change when the version advances, so a fix committed at the same version is invisible to consumers. Use patch (`1.0.4 → 1.0.5`) for fixes, minor for new tools/features. The build injects the version into the bundle via `--define:__PLUGIN_VERSION__` (from `$npm_package_version`), so the version must be set **before** step 2.
2. **Build all.** `npm run build` (rebuilds `dist/index.js` + `dist/frontmatter.mjs` + `dist/privacy-filter.mjs`). The committed `dist/` must match the source — a stale `dist/` ships an older bundle at a newer version number.
3. **Test all.** `npm test` (the full unit/component suite, `maxWorkers=1` — see the run output for the current count) AND `npm run typecheck` (`tsc --noEmit`). Both must pass clean. If you add or change behavior, add/adjust tests in `src/__tests__/` first.

Only after all three are green: `git add -A && git commit` from the plugin root, then push.

## Architecture

This is an MCP server that exposes 12 tools for persistent memory management. It runs as a stdio process registered with Claude Code via `claude mcp add`. The entry point `src/index.ts` is a thin boot stub (signal handlers + `main()`); everything else is split across focused modules:

- `src/server.ts` — `Server` construction, the 12 tool schemas, the `CallTool` dispatch switch, and `main()`
- `src/state.ts` — the shared in-memory singletons (`memIndex`, `invertedIndex`, `errors`, `perfSamples`). These are `const` objects with a stable identity; every module that reads/writes the index imports them from here so there is exactly one index across the process. Mutate in place (`memIndex[key] = …`, `delete memIndex[key]`); the two sites that formerly reassigned them (`loadIndexes`, `rebuildInvertedIndex`) now clear-then-populate the same object
- `src/paths.ts` — vault/DB/index paths, `EXCLUDED_DIRS`, `DEFAULT_CATEGORIES`, `ensureDir`
- `src/types.ts` — `MemoryFrontmatter`, `MemoryMetadata`, `Index`, `InvertedIndex`
- `src/lru-cache.ts` — `LRUCache` + the shared `contentCache` instance
- `src/persistence.ts` — `loadIndexes`, debounced `scheduleSave`/`scheduleIdfRecalc`, `saveNow`/`recalcIdfNow`/`flushPending`, `buildIndexCache` (owns the debounce timers)
- `src/tfidf.ts` — `tokenize`, `rebuildInvertedIndex`, `tfidfSearch`
- `src/vault-scan.ts` — `reconcileIndex`, `indexFile`, `deriveCategory`, `keyFromPath`, `slugify`, `tokenEstimate`
- `src/dates.ts` — `parseRelativeDate`
- `src/journal.ts` — `appendJournal`
- `src/tools/{store,recall,query,mutate}.ts` — the 12 tool implementations

**Data flow:**
1. On boot, loads `~/.total-recall/index.json` into `memIndex` (invertedIndex.json is NOT loaded — `main()` rebuilds the inverted index synchronously via `recalcIdfNow` right after `reconcileIndex`, so the disk copy was a dead read; `markIndexFresh` then gates the debounced recalc so the boot timer doesn't redo it). Always scans both vaults (unconditional; reconciles against disk to surface newly pulled org memories and catch missed flushes).
2. All tool calls operate against the in-memory `memIndex` (Record<key, MemoryMetadata>).
3. Writes are debounced: `scheduleSave()` waits 1s → writes index → triggers `scheduleIdfRecalc()` at +2s → rebuilds TF-IDF inverted index → writes `.index-cache.txt`.

**Dual vault routing:**
- Personal vault: `~/.total-recall/personal-vault/` — default for all memories
- Org vault: `~/.total-recall/org/org-vault/` — used when tag `org` is present; synced to the repo configured via `orgRepo` in `~/.total-recall/config.json` (branch `org-vault`) via `scripts/sync-org-memory.mjs`
- Keys are relative paths from vault root; org keys are prefixed `org/`
- Org sync runs a privacy filter: blocks secret tokens and all email addresses (fail-closed by default; allow your company domain via `allowedEmailDomains` in `~/.total-recall/config.json`) before any push. (Pronouns and phone numbers were intentionally removed from the filter — both had false-positive rates high enough to block legitimate org memories; the real "personal, don't sync" guard is the mutual-exclusion of the `personal` and `org` tags.)

**Search pipeline:**
- Primary: TF-IDF (`invertedIndex.json`) × Ebbinghaus retention decay (`src/ebbinghaus.ts`)
- TF-IDF tokenizes over `title + tags + contentPreview` (first ~500 chars of body stored in the index, not the full file); the boost path (`×2` title match, `×1.5` tag match) memoizes the lowercased title + tags per doc-key across the query-token loop, so a Q-token query matching D docs pays one `toLowerCase` per doc, not Q·D — never re-introduce a per-(token, doc) `toLowerCase` in `tfidfSearch`
- Optional hybrid: TF-IDF + vector embeddings fused via Reciprocal Rank Fusion (`src/rrf.ts`)
- Vector path requires optional deps (`@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`); gracefully degrades to TF-IDF on any vector-path error (embed/sqlite-vec/RRF), recording the failure to `get_stats.recentErrors` via `recordError` so a recurring vector failure is observable, not silent

**Supporting modules:**
- `src/frontmatter.ts` — minimal YAML-frontmatter parse/stringify (replaces gray-matter; handles inline + block arrays, immune to the js-yaml merge-key DoS)
- `src/ebbinghaus.ts` — retention strength formula: `importance × exp(-λ × days) × (1 + accessCount × 0.2)`
- `src/embeddings.ts` — lazy-loads HuggingFace pipeline (`Xenova/all-MiniLM-L6-v2`), no-op if missing
- `src/vectorStore.ts` — sqlite-vec upsert/search/delete wrapper
- `src/rrf.ts` — Reciprocal Rank Fusion (k=60)

**Hooks** (`hooks/hooks.json`):
- `SessionStart`: pull org vault → rebuild index cache → inject memory index → inject open questions
- `PostToolUse` (store/update/delete): sync to org vault if tagged `org`
- `PreCompact`: extract 0–3 learnings from transcript via `extract-and-store-memories.sh` (reads `transcript_path` from the hook's stdin JSON — Claude Code's common hook input, *not* an env var) → pipes JSON lines to `hooks/scripts/store-learning.mjs` which writes them directly as frontmatter `.md` files to the personal vault (no MCP round-trip; never overwrites existing files)

## Memory Workflow

When using total-recall tools, follow the retrieval order in `skills/memory-workflow/SKILL.md`:
1. Check the injected index already in context (free)
2. `get_memories_by_keys(..., summary=true)` — if key is known
3. `get_memories_by_keys(..., summary=false)` — if full content needed
4. `search_index(query=...)` — metadata-only, no file reads
5. `recall_memory(query=..., full=false)` — TF-IDF + Ebbinghaus
6. `recall_memory(query=..., full=true)` — with full content

Every stored memory must include a `## Executive Summary` section (answers WHY it matters, not just WHAT). Call `store_memory` from the main agent, never a subagent. Check for duplicates with `search_index` before storing. Set `importanceScore` (0.3=low, 0.7=high, 1.0=critical).

## Review-Fix-Ship Loop

For iterative hardening of a git repository ("review and fix", "harden and ship", "iterate until clean"), follow `skills/review-fix-ship/SKILL.md`. One pass = review with `file:line` citations -> apply all fixes -> run the pre-commit checklist above (bump version -> build -> test -> typecheck) -> commit -> push; repeat the pass until a full pass produces no changes (`git diff --stat` empty). Stop after the review step if the user only asked for a review (no fixes/shipping authorized) — do NOT enter the loop.

## Key Gotchas

- `org` tag routes to the shared vault
- `EXCLUDED_DIRS` in `src/paths.ts` skips `projects`, `templates`, `.obsidian`, etc. during vault scan
- `category` is derived from the first subdirectory under the vault root; files at vault root get category `knowledge`
- `journal` entries are auto-appended on `store_memory` only (personal memories only — org stores are skipped); `update_memory` and `delete_memory` do NOT write journal entries; never store to `journal` manually
- `since`/`before` date filters in `recall_memory` / `search_index` / `get_timeline` silently exclude memories with a missing `updated` field (by design); `list_memories` has no date filter
- `rebuild_index` preserves `accessCount`/`lastAccessed` — safe to run anytime
- `store_memory` `force=true` — overwrites an existing memory at the same key, preserving `created` and `accessCount`; without it, a duplicate key throws
- Org memory author protection — both `store_memory` (even with `force=true`) and `update_memory` throw if the existing org memory's `author` field differs from the current OS user; personal memories have no author guard
- `personal` + `org` tags are mutually exclusive — `store_memory` throws if both are present on the same memory
- `sessions` history in `update_memory` — deduplicated, capped at the last 50 entries; not replaced wholesale
- `contentCache` is an LRU (100 entries, 30-min TTL) — `recall_memory(full=true)` and `get_memories_by_keys` read through it; `update_memory` and `delete_memory` invalidate entries on write
- Build externalizes `@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`, and `fsevents` — these must remain optional
- `category` is path-containment-checked — `store_memory` resolves `<vault>/<category>` and rejects values (e.g. `../../../tmp`) that escape the vault root; never trust `category` as a raw path
- Org-author guard **ignores** the caller-supplied `author` for org memories — `effectiveAuthor` is always `os.userInfo().username` for org writes, so `author:'someone-else'` + `force:true` cannot overwrite another author's org memory
- Frontmatter scalars reject embedded newlines — `frontmatter.ts` throws if a `title`/`tags` value contains `\r` or `\n`, preventing injection of a new frontmatter key from a scalar value
- Index files (`index.json`, `invertedIndex.json`, `.index-cache.txt`) are written atomically via write-`.tmp` + `rename` — `persistence.ts` `atomicWrite()`; never write these files directly with a plain `writeFileSync`
- `flushPending` (the SIGTERM/SIGINT/beforeExit flush) gates the O(N) `recalcIdfNow` on `dirtyTokens || idfTimer !== null` — a pure read-only exit (only a `scheduleAccessSave` access-bump pending, zero token changes) runs `saveNow` to persist the access bump but SKIPS the inverted-index rebuild, since the inverted index already reflects `memIndex`'s tokens. The once-per-session rebuild backstop is preserved only when tokens changed or a recalc was already queued; never make `flushPending` unconditionally call `recalcIdfNow` again, or every read-only session pays a full `rebuildInvertedIndex` + `invertedIndex.json` write on shutdown.
- `index.json` has a **single-writer assumption** — no `flock`/CAS. Each Claude Code window spawns its own total-recall process; concurrent sessions both flush via `atomicWrite` and last rename wins. Disk-durable fields (`title`/`tags`/`content`/`sessions`) are re-derived from `.md` files on boot, so a clobber loses no memory content — only the runtime-only `accessCount`/`lastAccessed` (soft Ebbinghaus signals) can be reset. Don't run multiple heavy-write sessions in parallel if retention-decay accuracy matters
- SessionStart hooks emit `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}` — omitting `hookEventName` silently drops the context (the plugin's core feature); JSON-encoding uses `node`, not `python3`
- Frontmatter keys are escaped (`escapeRegExp`) before being interpolated into a RegExp in `frontmatter.ts` — a key is any `[^:\s]+` literal (incl. metacharacters; a teammate can push one via the shared org vault), so it must match literally; never interpolate a parsed key into `new RegExp` raw, or a key like `(a+)+` is mis-matched and an explicit `(a+)+: []` array is wrongly dropped
- The org `index.json` is the source of truth that `scripts/sync-org-memory.mjs` commits to the shared `org-vault` branch, so a corrupt parse must NOT be catch-wiped: `loadOrgIndex` throws when the file exists but is unparseable/non-object (interrupted `atomicWrite`, bad manual edit, merge-conflict marker) and the throw propagates to `main().catch` (logged to `~/.total-recall/org/.sync-errors.log`, exit 0), leaving the file untouched for manual recovery. Cold start (no `index.json` yet) returns `{}` — the first sync must be allowed to create it. The personal `index.json` is self-healing (rebuilt from `.md` files on boot); the org one is not.
- `reconcileIndex`'s walk catches `readdirSync` per directory. ENOENT (a dir gone since the walk scheduled it) skips silently, but a NON-ENOENT error (EACCES on a chmod'd subdir, EMFILE on fd exhaustion) is recorded via `recordError` (`reconcile readdirSync(<dir>): …`) so the subtree that just "vanished" from search is observable in `get_stats.recentErrors` instead of silently pruned — never wrap that readdirSync in a bare `catch { return; }` again, or an unreadable vault subdir becomes invisible with no signal.
