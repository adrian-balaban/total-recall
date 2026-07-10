# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Bundle src/index.ts → dist/index.js (esbuild, ESM)
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

`install.sh` (plugin root) is the one-shot, state-aware setup script: profile prompt (a. default — no optional deps / b. complete — vector search) → vault dirs → MCP registration → index build → optional standalone hook wiring / org vault / vector search → verify. Run `./install.sh --help` for flags (`-y`, `--default`/`--complete`, `--standalone`, `--org-repo`, `--allowed-email-domain`, `--vector`/`--no-vector`). User-facing install docs live in `INSTALL.md` (incl. Windows/Git Bash notes) — keep it in sync with install.sh flags. Its `--standalone` step embeds the canonical hooks JSON inline — keep that block in sync with `hooks/hooks.json` if hook commands, timeouts, or the build→load ordering change.

## Build artifacts (`dist/`)

`dist/` is **intentionally committed to git**. The plugin is distributed via `git-subdir` in the marketplace, so consumers need the built artifacts without running `npm run build` themselves. Always run `npm run build` before committing to ensure `dist/` stays in sync with source.

## Before committing — mandatory pre-commit checklist

Run all three, in order, **before every commit** that touches source or the plugin manifest (not just releases). The plugin is distributed via `git-subdir`, so a committed-but-untested change ships to consumers on `claude plugin update` with no CI gate in between.

1. **Increase the version.** Bump the version in **`package.json` only** — it is the single source of truth. Do **not** edit `.claude-plugin/plugin.json`'s version by hand: the `npm run build` step (below) runs `sync:version` (`scripts/sync-version.mjs`), which copies `package.json`'s version into `plugin.json` automatically, so the two can never drift. `claude plugin update` only picks up the change when the version advances, so a fix committed at the same version is invisible to consumers. Use patch (`1.0.4 → 1.0.5`) for fixes, minor for new tools/features. The build injects the version into the bundle via `--define:__PLUGIN_VERSION__` (from `$npm_package_version`), so the version must be set **before** step 2.
2. **Build all.** `npm run build` (rebuilds `dist/index.js` + `dist/frontmatter.mjs` + `dist/privacy-filter.mjs`). The committed `dist/` must match the source — a stale `dist/` ships an older bundle at a newer version number.
3. **Test all.** `npm test` (the full unit/component suite, `maxWorkers=1` — see the run output for the current count) AND `npm run typecheck` (`tsc --noEmit`). Both must pass clean. If you add or change behavior, add/adjust tests in `src/__tests__/` first.

Only after all three are green: `git add -A && git commit` from the plugin root, then push.

## Architecture

This is an MCP server that exposes 17 tools for persistent memory management. It runs as a stdio process compatible with Claude Code, Gemini CLI, and GitHub Copilot CLI. The entry point `src/index.ts` is a thin boot stub (signal handlers + `main()`); everything else is split across focused modules:

- `src/server.ts` — `Server` construction, the 17 tool schemas, the `CallTool` dispatch table, and `main()`
- `src/state.ts` — the shared in-memory singletons (`memIndex`, `invertedIndex`, `errors`, `perfSamples`). These are `const` objects with a stable identity; every module that reads/writes the index imports them from here so there is exactly one index across the process. Mutate in place (`memIndex[key] = …`, `delete memIndex[key]`); the two sites that formerly reassigned them (`loadIndexes`, `rebuildInvertedIndex`) now clear-then-populate the same object
- `src/paths.ts` — vault/DB/index paths (supports custom paths resolved from `~/.total-recall/config.json`), `EXCLUDED_DIRS`, `DEFAULT_CATEGORIES`, `ensureDir`
- `src/types.ts` — `MemoryFrontmatter`, `MemoryMetadata`, `Index`, `InvertedIndex`
- `src/lru-cache.ts` — `LRUCache` + the shared `contentCache` instance
- `src/persistence.ts` — `loadIndexes`, debounced `scheduleSave`/`scheduleIdfRecalc` (saves the incrementally updated inverted index to disk), `saveNow`/`recalcIdfNow`/`flushPending`, `buildIndexCache` (owns the debounce timers)
- `src/tfidf.ts` — `tokenize`, `rebuildInvertedIndex`, `registerDocument`/`deregisterDocument` (incremental updates), `tfidfSearch` (supports RO/EN bilingual query expansion if `enableMultilingualSearch` is true)
- `src/vault-scan.ts` — `reconcileIndex`, `indexFile`, `deriveCategory`, `keyFromPath`, `slugify`, `tokenEstimate`
- `src/dates.ts` — `parseRelativeDate`
- `src/journal.ts` — `appendJournal`
- `src/tools/{store,recall,query,mutate,rerank,bulk}.ts` — the 17 tool implementations

**Data flow:**
1. On boot, loads `~/.total-recall/index.json` into `memIndex` (invertedIndex.json is NOT loaded — `main()` rebuilds the inverted index synchronously via `recalcIdfNow` right after `reconcileIndex`, so the disk copy was a dead read; `markIndexFresh` then gates the debounced recalc so the boot timer doesn't redo it). Always scans both vaults (unconditional; reconciles against disk to surface newly pulled org memories and catch missed flushes).
2. All tool calls operate against the in-memory `memIndex` (Record<key, MemoryMetadata>).
3. Writes are debounced: `scheduleSave()` waits 1s → writes index → triggers `scheduleIdfRecalc()` at +2s → writes `.index-cache.txt` and `invertedIndex.json` incrementally (no full rebuild).

**Dual vault routing:**
- Personal vault: `~/.total-recall/personal-vault/` (unless overridden in `config.json` via `personalVault`) — default for all memories
- Org vault: `~/.total-recall/org/org-vault/` (unless overridden in `config.json` via `orgVault`) — used when tag `org` is present; synced to the repo configured via `orgRepo` in `~/.total-recall/config.json` (branch `org-vault`) via `scripts/sync-org-memory.mjs`
- Keys are relative paths from vault root; org keys are prefixed `org/`
- Org sync runs a privacy filter: blocks secret tokens and all email addresses (fail-closed by default; allow your company domain via `allowedEmailDomains` in `~/.total-recall/config.json`) before any push. (Pronouns and phone numbers were intentionally removed from the filter — both had false-positive rates high enough to block legitimate org memories; the real "personal, don't sync" guard is the mutual-exclusion of the `personal` and `org` tags.) The `EMAIL_RE` host class includes non-ASCII (IDN) chars (` -`) so a personal email at an internationalized host (`user@münchen.de`, `user@пример.рф`) is blocked just like an ASCII one — never narrow the host class back to ASCII-only, or the IDN bypass reopens; the IDN cases are pinned by a regression test in `sync-org-memory.test.ts`.

**Search pipeline:**
- Primary: TF-IDF (`invertedIndex.json`) × Ebbinghaus retention decay (`src/ebbinghaus.ts`). Expanded with RO/EN translations if `enableMultilingualSearch` is true.
- TF-IDF tokenizes over `title + tags + contentPreview` (first ~500 chars of body stored in the index, not the full file); the boost path (`×2` title match, `×1.5` tag match) memoizes the lowercased title + tags per doc-key across the query-token loop, so a Q-token query matching D docs pays one `toLowerCase` per doc, not Q·D — never re-introduce a per-(token, doc) `toLowerCase` in `tfidfSearch`
- Optional hybrid: TF-IDF + vector embeddings fused via Reciprocal Rank Fusion (`src/rrf.ts`)
- Vector path supports HuggingFace (`Xenova/all-MiniLM-L6-v2`), Ollama, and Vertex AI embedding providers. Gracefully degrades to TF-IDF on any vector-path error (embed/sqlite-vec/RRF), recording the failure to `get_stats.recentErrors` via `recordError` so a recurring vector failure is observable, not silent

**Supporting modules:**
- `src/frontmatter.ts` — minimal YAML-frontmatter parse/stringify (replaces gray-matter; formats/sorts keys consistently: title, tags, author, sessions, created, updated, importanceScore, custom)
- `src/ebbinghaus.ts` — retention strength formula: `importance × exp(-λ × days) × (1 + accessCount × 0.2)`
- `src/embeddings.ts` — supports in-process HuggingFace, Ollama API, and GCP Vertex AI embeddings
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
- `slugify` (vault-scan.ts) collapses an empty or all-punctuation title to `''`, then falls back to the literal slug `'untitled'` (`slug || 'untitled'`) — without it an empty title would produce `knowledge/.md` with the path-shaped key `knowledge/`. Pinned by `slugify` tests in `vault-scan.test.ts`; never drop the `|| 'untitled'` fallback
- `journal` entries are auto-appended on `store_memory` only (personal memories only — org stores are skipped); `update_memory` and `delete_memory` do NOT write journal entries; never store to `journal` manually
- `since`/`before` date filters in `recall_memory` / `search_index` / `get_timeline` silently exclude memories with a missing `updated` field (by design); `list_memories` has no date filter
- `rebuild_index` preserves `accessCount`/`lastAccessed` — safe to run anytime
- `store_memory` `force=true` — overwrites an existing memory at the same key, preserving `created` and `accessCount`; without it, a duplicate key throws. Refused if the existing memory is tagged `no-prune` (immortal) — even with `force=true` — because a routine re-store could silently strip the tag and quietly make the memory mortal again
- `no-prune` tag (immortality) — a memory carrying the `no-prune` tag (constant `NO_PRUNE_TAG` in `src/paths.ts`) is (a) excluded from `prune_memories` candidates *before* the retention filter, so it never counts toward `limit` either, (b) refused by `delete_memory` unless `force=true` is passed (mirrors `store_memory`'s `force` pattern), and (c) refused by `store_memory` even with `force=true` — the third removal path, closed so a content re-store can't silently rewrite an ADR's body or strip the tag. Use it for decisions that must not decay out of the prune list or be removed by mistake (e.g. an ADR). Tag-only by design: the `decisions` category is NOT auto-protected — not every decision is immortal, immortality is an explicit per-memory opt-in. The guards are orthogonal to authorship, so they block even the org author; `delete_memory` `force=true` still allows a deliberate teardown (then a fresh store). Amend-in-place uses `update_memory` (it does NOT strip tags). Pinned by `pruneMemories` no-prune exclusion tests in `query.test.ts` and the `delete_memory` force-guard + `store_memory` no-prune guard tests in `index.test.ts`
- Org memory author protection — both `store_memory` (even with `force=true`) and `update_memory` throw if the existing org memory's `author` field differs from the current OS user; personal memories have no author guard
- `personal` + `org` tags are mutually exclusive — `store_memory` throws if both are present on the same memory
- `update_memory` treats a caller-supplied SCALAR `tags` arg (non-array) as lenient: it ignores the field and keeps the existing tags, NOT wipes them to `[]`. The MCP schema declares `tags` as `array`, so a well-behaved client never sends a scalar, but a direct/malformed caller can — and the pre-fix `Array.isArray(tags ?? parsed.data.tags) ? ... : []` wiped the whole field on a scalar (silent data loss on an update that meant to leave tags alone, e.g. only changing `content`). A proper array still replaces; `undefined` (arg omitted) keeps existing. Pinned by T3 regression tests in `index.test.ts` (scalar-keep / array-replace / undefined-keep).
- `sessions` history in `update_memory` — deduplicated, capped at the last 50 entries; not replaced wholesale
- `contentCache` is an LRU (100 entries, 30-min TTL) — `recall_memory(full=true)` and `get_memories_by_keys` read through it; `update_memory` and `delete_memory` invalidate entries on write
- Build externalizes `@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`, and `fsevents` — these must remain optional
- `category` is path-containment-checked — `store_memory` resolves `<vault>/<category>` and rejects values (e.g. `../../../tmp`) that escape the vault root; never trust `category` as a raw path
- `store_memory` rejects a personal (no `org` tag) memory whose `category` is `org` OR any `org/`-prefixed value (e.g. `org/architecture`). The `org/` key prefix is reserved for the org vault, and `reconcileIndex` skips the personal-vault `org/` subtree (so a personal `org/` dir is never mistaken for the org vault) — a personal write landing there is silently orphaned (written, never indexed, invisible to every search/recall/list tool). The guard must catch the *prefix*, not just the exact string `=== 'org'`; a bare `===` guard let `category: 'org/something'` through, writing under `personal-vault/org/...` and losing the memory. Route org memories via the `org` tag, never a reserved `org/` category. Pinned by regression tests in `index.test.ts` (exact + prefix forms, asserting nothing is written to disk).
- Org-author guard **ignores** the caller-supplied `author` for org memories — `effectiveAuthor` is always `os.userInfo().username` for org writes, so `author:'someone-else'` + `force:true` cannot overwrite another author's org memory
- Frontmatter values reject embedded newlines — `frontmatter.ts` throws if a scalar value (`serializeString`) OR an inline-array item (`serializeArrayItem`, e.g. a `tags` element) contains `\r` or `\n`, preventing injection of a new frontmatter key from a value. Both arms (scalar + array-item) are pinned by `frontmatter.test.ts` (the array-item arm is the T4 regression — a `\n` in `tags: [a\nb]` would terminate the frontmatter line and inject the following text as a new key on re-parse)
- `withExecutiveSummary` (frontmatter.ts) is idempotent — re-applying to content that already begins with `## Executive Summary` (after `trimStart()`) does NOT prepend a second copy. Without the trimStart check, a caller that normalizes user-supplied content via `withExecutiveSummary` (e.g. `update_memory` on a body that already shipped) would double the header on every edit, growing the file. The first-time path (no header yet) prepends; the re-apply path is a no-op. Pinned by T5 tests in `frontmatter.test.ts` (header-present + leading-whitespace cases, asserting exactly one `## Executive Summary`).
- `privacy-filter.ts` `safeStringify` catches circular refs / BigInt and returns `''` so the filter can never crash-open on a hand-edited teammate-pushed frontmatter value. A thrown `JSON.stringify` would let a secret-laden file sail past the filter by crashing it; the fallback is conservative (the named-field text in `text` still scans title/author/tags/sessions and the body, so a secret in a named field OR body is still caught). Pinned by T6 tests in `sync-org-memory.test.ts` (circular `data.self = data` does not throw; named-field email in a circular object is still blocked).
- T2: `store_memory` rejects `category: 'org'` AND `category: 'org/something'` (the prefix form) for a personal memory — both arms pinned by `index.test.ts` "Reserved Org Cat" (exact) and "Prefix Org Cat" (prefix) tests, which assert the throw AND no stray file under `personal-vault/org/`. The pre-fix exact-only `===` guard let `category: 'org/architecture'` through, writing under `personal-vault/org/architecture/foo.md` and orphaning the file (reconcileIndex skips the personal `org/` subtree).
- Index files (`index.json`, `invertedIndex.json`, `.index-cache.txt`) are written atomically via write-`.tmp` + `rename` — `persistence.ts` `atomicWrite()`; never write these files directly with a plain `writeFileSync`
- `flushPending` (the SIGTERM/SIGINT/beforeExit flush) gates the O(N) `recalcIdfNow` on `dirtyTokens || idfTimer !== null` — a pure read-only exit (only a `scheduleAccessSave` access-bump pending, zero token changes) runs `saveNow` to persist the access bump but SKIPS the inverted-index rebuild, since the inverted index already reflects `memIndex`'s tokens. The once-per-session rebuild backstop is preserved only when tokens changed or a recalc was already queued; never make `flushPending` unconditionally call `recalcIdfNow` again, or every read-only session pays a full `rebuildInvertedIndex` + `invertedIndex.json` write on shutdown.
- `index.json` has a **single-writer assumption** — no `flock`/CAS. Each Claude Code window spawns its own total-recall process; concurrent sessions both flush via `atomicWrite` and last rename wins. Disk-durable fields (`title`/`tags`/`content`/`sessions`) are re-derived from `.md` files on boot, so a clobber loses no memory content — only the runtime-only `accessCount`/`lastAccessed` (soft Ebbinghaus signals) can be reset. Don't run multiple heavy-write sessions in parallel if retention-decay accuracy matters
- SessionStart hooks emit `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}` — omitting `hookEventName` silently drops the context (the plugin's core feature); JSON-encoding uses `node`, not `python3`
- Frontmatter keys are escaped (`escapeRegExp`) before being interpolated into a RegExp in `frontmatter.ts` — a key is any `[^:\s]+` literal (incl. metacharacters; a teammate can push one via the shared org vault), so it must match literally; never interpolate a parsed key into `new RegExp` raw, or a key like `(a+)+` is mis-matched and an explicit `(a+)+: []` array is wrongly dropped
- The org `index.json` is the source of truth that `scripts/sync-org-memory.mjs` commits to the shared `org-vault` branch, so a corrupt parse must NOT be catch-wiped: `loadOrgIndex` throws when the file exists but is unparseable/non-object (interrupted `atomicWrite`, bad manual edit, merge-conflict marker) and the throw propagates to `main().catch` (logged to `~/.total-recall/org/.sync-errors.log`, exit 0), leaving the file untouched for manual recovery. Cold start (no `index.json` yet) returns `{}` — the first sync must be allowed to create it. The personal `index.json` is self-healing (rebuilt from `.md` files on boot); the org one is not.
- `reconcileIndex`'s walk catches `readdirSync` per directory. ENOENT (a dir gone since the walk scheduled it) skips silently, but a NON-ENOENT error (EACCES on a chmod'd subdir, EMFILE on fd exhaustion) is recorded via `recordError` (`reconcile readdirSync(<dir>): …`) so the subtree that just "vanished" from search is observable in `get_stats.recentErrors` instead of silently pruned — never wrap that readdirSync in a bare `catch { return; }` again, or an unreadable vault subdir becomes invisible with no signal.
- `loadMemIndex` (`persistence.ts`) reads the personal `index.json` at boot with a try/catch. ENOENT is the expected cold start (no index.json yet — the first store creates it) and stays silent, but a NON-ENOENT failure (corrupt JSON from an interrupted `atomicWrite`, a bad manual edit, EACCES) is recorded via `recordError` (`loadMemIndex parse failed (rebuilding from .md files): …`). The personal index is self-healing (`reconcileIndex` rebuilds from the `.md` files), so it isn't data loss — but the silent discard would hide a real condition and the loss of the runtime-only `accessCount`/`lastAccessed` fields. Never collapse that catch back to a bare `catch { return; }`, or a corrupt index.json becomes invisible. (Distinct from the org-index guard in `sync-org-memory.mjs`, which THROWS on a corrupt committed index that propagates via git; this is local-only and benign.) Pinned by regression tests in `persistence-loadmemindex-error.test.ts` (parse + EACCES record, ENOENT silent).
