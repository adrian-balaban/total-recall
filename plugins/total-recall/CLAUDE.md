# 📘 CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⌨️ Commands

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

## 📌 Docs must track install.sh

`README.md` / `INSTALL.md` client-support claims (profile flags, per-client status like Gemini/Antigravity (agy)) must match `install.sh`'s actual flags/behavior — they've drifted before (e.g. README labeling a fully-supported client as "work in progress"). Cross-check all three when touching any one.

## 🚀 Install / setup

`install.sh` (plugin root) is the one-shot, state-aware setup script. It prompts for a profile, creates vault directories (including one-time local-only `git init` of the personal vault), registers MCP, builds the index, then configures optional org vault/vector search and verifies. Hooks are not wired manually; they auto-load from `hooks/hooks.json`. `claude plugin install "$(pwd)"` does **not** work — `claude plugin install` only accepts `plugin[@marketplace]`, never a filesystem path. A manual clone gets installed either via the root `./install.sh` (builds, stages a clean copy, registers it as a `total-recall-local` directory marketplace, installs it, then runs its `install.sh` — see [INSTALL.md § Install from a local clone](INSTALL.md#-install-from-a-local-clone-build-it-yourself)), or for a dev-only session, `claude --plugin-dir "$(pwd)"`.

Flags: `-y`/`--yes`, `--strict`, `--default`/`--complete`/`--vector`, `--no-vector`, `--statusline`, `--gemini` (requires `agy`), `--vscode`, `--org-repo`, `--allowed-email-domain`, `--plugin-root`, `--rebuild`, `-h`/`--help`.

- `--strict` is the only flag that changes the exit code: it turns collected verification failures into `exit 1`. The default remains warn-and-exit-0.
- `--org-repo` is host-agnostic (`https://` or `git@`). Keep its help, prompt and INSTALL.md in agreement.
- User-facing install docs live in `INSTALL.md`; keep flags and behavior in sync.
- The old `--standalone` hook-wiring path is removed. `hooks/hooks.json` is the only hook source.

## 📦 Build artifacts (`dist/`)

`dist/` is **gitignored — never commit it.** It is produced by GitHub Actions and by nothing else in the normal flow.

How the pieces fit:

- `.github/workflows/mutation.yml` is the gate: `npm ci` → audit → typecheck → build (which also checks manifest sync) → full coverage suite → integration tests → Stryker ≥65% → root npx launcher tests/pack guard. Build before tests because `hooks/scripts/store-learning.mjs` imports `dist/frontmatter.mjs`; run the full suite because Stryker's dry run only executes the curated allow-list. It runs on every push/PR to `main`.
- `.github/workflows/release.yml` runs after a green gate, rebuilds `dist/`, and force-pushes `main`'s tree plus `dist/` to `release`, removing contributor-only files while keeping `src/`, `tsconfig.json` and the lockfile. When the version advances, it also cuts a tag/release and publishes the npx bootstrap to npm (Node 22 + npm 11.5.1+).
- `.claude-plugin/marketplace.json` pins its `git-subdir` source to `"ref": "release"`; `main` stays artifact-free.

Consequences worth internalising:

- **Do not `git add -f dist/`.** CI is the only normal writer; a hand-built bundle bypasses the gate.
- **A change reaches consumers only when the release workflow refreshes `release` after a green gate.**
- Locally, `npm run build` is a dev convenience for the server, integration tests and `store-learning.mjs`; its output is gitignored.
- `install.sh` builds `dist/` when missing and detects the plugin root by the tracked `.claude-plugin/plugin.json`.

## 🚚 Distribution

**Marketplace plus installer.** Supported path:

```
/plugin marketplace add adrian-balaban/total-recall
/plugin install total-recall@my-claude-plugins
```

Then run `./install.sh` inside the installed plugin for vaults/MCP registration. Releases carry notes and a tag but no zip artifact, keeping one channel for plugin code.

**npx bootstrap (since 1.7.0).** `npx @adrian-balaban/total-recall` runs the marketplace commands and then `install.sh`. It lives at the repository root, has no dependencies and ships no plugin code (`test/pack-guard.mjs` enforces this). `release.yml` publishes it with provenance through Trusted Publishing when the version advances; its `node:test` suite runs in `mutation.yml` outside Stryker scope. Never move plugin code into that package.

## ✅ Before committing

There is no local release pipeline; GitHub Actions is the verification gate.

- Bump the version in `package.json` only. `npm run build` runs `sync:version`, updating `.claude-plugin/plugin.json`, `gemini-extension.json` and the root npx manifest. A fix committed at the same version is invisible to `claude plugin update`.
- Running `npm test` and `npm run typecheck` locally is optional. When you do, use a clean `HOME` (for example `HOME=$(mktemp -d) npm test`): developer config can make env-dependent tests pass locally and fail on CI.
- A red gate keeps consumers on the last good `release` build, but that is silent; check the workflow run after pushing a fix users should receive.
- Commits and tags are currently unsigned. `release.yml` publishes the release branch as `github-actions[bot]`. Commit signing would be valuable because distribution fetches directly from git history, but enable it only together with enforcement. See [PLAN-SIGNED-RELEASES.md](../../backlog-and-plans/PLAN-SIGNED-RELEASES.md).

## 🏗️ Architecture

This is an MCP server that exposes 22 tools: 17 for persistent memory management and 5 spec-driven architecture tools (on by default; `specDriven` in config.json, see the root `README.md`). It runs as a stdio process compatible with Claude Code and Gemini/Antigravity. The entry point `src/index.ts` is a thin boot stub (signal handlers + `main()`); everything else is split across focused modules:

- `src/server.ts` — `McpServer` construction, `register(server)` calls and `main()`. `specDriven` is read once at module load, so changes need a restart. Tool schemas/handlers live in `tools/*.ts`; `registerTool` validates at the dispatch boundary.
- `src/state.ts` — shared in-memory singletons (`memIndex`, `invertedIndex`, `errors`, `perfSamples`). Mutate them in place; do not reassign the singleton objects.
- `src/paths.ts` — vault/DB/index paths (supports custom paths resolved from `~/.total-recall/config.json`), `EXCLUDED_DIRS`, `DEFAULT_CATEGORIES`, `ensureDir`
- `src/types.ts` — `MemoryFrontmatter`, `MemoryMetadata`, `Index`, `InvertedIndex`
- `src/lru-cache.ts` — `LRUCache` + the shared `contentCache` instance
- `src/persistence.ts` — `loadIndexes`, debounced `scheduleSave`/`scheduleIdfRecalc` (saves the incrementally updated inverted index to disk), `saveNow`/`recalcIdfNow`/`flushPending`, `renderIndexCache` (the injected index text rendered from memory, no file write; owns the debounce timers)
- `src/tfidf.ts` — `tokenize`, `rebuildInvertedIndex`, `registerDocument`/`deregisterDocument` (incremental updates), `tfidfSearch` (supports RO/EN bilingual query expansion if `enableMultilingualSearch` is true)
- `src/vault-scan.ts` — `reconcileIndex`, `indexFile`, `slugify`, `tokenEstimate` (re-exports `keyFromPath`/`deriveCategory`/`isReservedKey` from `vault-walk.ts`)
- `src/vault-walk.ts` — the one definition of which files in a vault are memories (`listVaultFiles`: skips symlinks, `EXCLUDED_DIRS` in any casing, and the personal `org/` subtree) and how keys/categories derive from paths. Imports only `paths` ([TR-S13])
- `src/index-cache.ts` + `src/hooks/build-index-cache.ts` — render and build `.index-cache.txt`. Since 1.8.0 it is capped by `indexMaxEntries` (default 300, `0` = no cap): no-prune first, then importance, then newest; the total and omitted count remain visible. The bundled entry is the cache's only writer ([TR-W8]) and imports only `paths`, the vault walk, `frontmatter` and `atomic-write` ([TR-S14]).
- `src/atomic-write.ts` — write-tmp + fsync + rename leaf, shared by `persistence.ts` and the cache bundle; failures go to a caller-supplied sink
- `src/dates.ts` — `parseRelativeDate`
- `src/journal.ts` — `appendJournal`
- `src/tools/architecture.ts` — the 5 spec-driven tools (`index_architecture`, `get_architecture_context`, `trace`, `get_architecture_history`, `validate_architecture`); `register(server, spec)` registers only `spec.tools`. Like `bulk.ts` it reuses `storeMemory`/`updateMemory`
- `src/spec/*` — spec-driven support: config/fields bundling for hooks, shared frontmatter sanitiser, parsing, indexing, context, validation, guardrails, schema, and `exec.ts` (the only spec module allowed to start processes, [TR-R4]).
- `src/tools/{store,recall,query,mutate,rerank,bulk}.ts` — the 17 core tools. Each module co-locates its Zod schema, handler and `register(server)`.
- `src/org-sync.ts` — `orgSync: "server"` mode: after an org-key store/update/delete it runs `hooks/scripts/sync-org-memory.sh` with `ORG_SYNC_FROM_SERVER=1`, keeping queue, lock and filter in one script. Default `hook` does nothing here.
- `src/host-context.ts` — MCP resources and prompts for hookless hosts; they never change `tools/list` ([TR-C7]).
- `src/tools/registry.ts` — `wrapHandler` provides the result envelope and perf/error recording. `registerTool` parses caller args before the handler; handler coercion remains for internal paths that bypass Zod.

**Data flow:**
1. On boot, load `index.json` into `memIndex`, rebuild the inverted index, and reconcile both vaults against disk so pulled org memories and missed flushes surface.
2. Tool calls operate against the in-memory `memIndex`.
3. Writes are debounced: save the index after 1s, then incrementally save the inverted index after another second. `.index-cache.txt` is written only by the SessionStart hook; the server renders the same text in memory for hookless hosts.

**Dual vault routing:**
- Personal vault: `~/.total-recall/personal-vault/` (unless overridden in `config.json` via `personalVault`) — default for all memories
- Org vault: `~/.total-recall/org/org-vault/` (overridable via `orgVault`), used for `org` memories and synced to `orgRepo`. Push and pull both use `config.orgBranch`, falling back to the local branch or `knowledge`.
- Who pushes: `orgSync` is `hook` by default, or `server` for hookless hosts. In server mode the hook skips org keys, so a write is never pushed twice.
- Keys are vault-root-relative paths; org keys are prefixed `org/`.
- Org privacy: pushes run a fail-closed filter before git for secret tokens, Luhn-valid cards, mod-97 IBANs, formatted phone numbers and emails outside `allowedEmailDomains`. The `personal`/`org` tag exclusion is the real don't-sync guard; the personal vault only warns on known-prefix secrets. Keep IDN email hosts supported; a regression test pins this.

**Search pipeline:**
- Primary: TF-IDF (`invertedIndex.json`) × Ebbinghaus retention decay (`src/ebbinghaus.ts`). Expanded with RO/EN translations if `enableMultilingualSearch` is true.
- TF-IDF indexes `title + tags + contentPreview` (first ~500 body characters). Title and tag boosts memoize lowercased per document; do not reintroduce a per-token/document `toLowerCase`.
- Optional hybrid: TF-IDF + vector embeddings fused via Reciprocal Rank Fusion (`src/rrf.ts`)
- Vector path uses the in-process HuggingFace pipeline (`Xenova/paraphrase-multilingual-MiniLM-L12-v2` by default since 1.6.8; `config.embeddingModel` overrides it). `reconcileVectors` re-embeds when the `vec_meta` model fingerprint changes ([TR-R6]). Read the model through `embeddingModel()`, not config directly. Vector errors degrade to TF-IDF and are recorded in `get_stats.recentErrors`.

**Supporting modules:**
- `src/frontmatter.ts` — minimal YAML-frontmatter parse/stringify (replaces gray-matter; formats/sorts keys consistently: title, tags, author, sessions, created, updated, importanceScore, custom)
- `src/ebbinghaus.ts` — retention strength formula: `clamp(importance × exp(-λ × days) × (1 + accessCount × 0.2 + confirmations × 0.1 − flags × 0.1), 0, 1)` (confirmations/flags come from `confirm_memory`)
- `src/embeddings.ts` — in-process HuggingFace embeddings; lazy-loaded, no-op if deps absent, failed loads retry. The model cache is `~/.total-recall/models`, so plugin updates do not redownload it. `depsInstalled()` is the capability probe used by `get_stats`; it is distinct from `isVectorAvailable()` (whether the pipeline has loaded). A true result latches per process; false re-probes after self-heal.
- `src/vectorStore.ts` — sqlite-vec upsert/search/delete wrapper
- `src/rrf.ts` — Reciprocal Rank Fusion (k=60)

**Hooks** (`hooks/hooks.json`):
- `SessionStart`: pull org vault → rebuild index cache (`build-memory-index.sh` → `dist/build-index-cache.mjs`) → inject memory index → check extraction outcomes (`check-extract-outcomes.sh` `[TR-P5]`: warns when ≥3 of the last 5 `.extract.log` outcomes are `cli-error`/`store-error`/`dropped`) → check org-sync errors (`check-sync-errors.sh` warns if pushes failed since the last success)
- `PostToolUse` (store/update/delete): sync to org vault if tagged `org` (skipped for org keys when `orgSync` is `server`; the server then runs the same script)
- `PostToolUse` (`Write|Edit|MultiEdit`): `architecture-change.sh` asks for a reindex + change memory when an `.adl` file is edited
- `PreCompact`: the nested `claude -p` is sandboxed since 1.8.0 (`--tools ""`, `--strict-mcp-config`, no slash commands, no session persistence); never re-add tools because the transcript is untrusted. It reads `transcript_path` from stdin JSON, extracts 0–3 learnings, appends one capped line to `~/.total-recall/.extract.log` per run, and `store-learning.mjs` writes non-overwriting `.md` files directly to the personal vault.
- `SessionEnd`: `session-end.sh` logs the session, SIGTERMs the MCP child to flush pending embedding writes, auto-commits the personal vault if it is a git repo (H1 durability; see gotcha), and emits `{"continue":true}` — NOT a `hookSpecificOutput.additionalContext` envelope (SessionEnd rejects that shape as "Invalid input", unlike SessionStart)

## 🧪 Toolchain

Use Node 20 locally (`.nvmrc`, `mise.toml`): it is what the gate runs, and a native module (`better-sqlite3`) built under another Node fails to load under this one (the three `vectorStore` tests then fail with `NODE_MODULE_VERSION`; fix with `npm rebuild better-sqlite3`). The npm release job uses Node 22 on purpose (trusted publishing).

## 🧠 Memory Workflow

When using total-recall tools, follow the retrieval order in `skills/memory-workflow/SKILL.md`:
1. Check the injected index already in context (free)
2. `get_memories_by_keys(..., summary=true)` — if key is known
3. `get_memories_by_keys(..., summary=false)` — if full content needed
4. `search_index(query=...)` — metadata-only, no file reads
5. `recall_memory(query=..., full=false)` — TF-IDF + Ebbinghaus
6. `recall_memory(query=..., full=true)` — with full content

For ADL projects, follow `skills/spec-driven-workflow/SKILL.md` (index → context before a change → validate → capture decisions with `system`/`elements`/`requirements`).

Every stored memory must include a `## Executive Summary` section (answers WHY it matters, not just WHAT). Call `store_memory` from the main agent, never a subagent. Check for duplicates with `search_index` before storing. Set `importanceScore` (0.3=low, 0.7=high, 1.0=critical).

## ⚠️ Key Gotchas

- Complexity/quality ratchets — [TR-Q9] fails if an unlisted function reaches cyclomatic complexity 10 or a baseline entry worsens/improves/disappears; shrink the baseline in the same PR. [TR-Q10] caps identical-line runs between production files at 10; [TR-Q11] warns when helpers change more than twice in 30 days. [TR-S12] requires every production file to match exactly one `COMPONENT_FILES` regex, with its owner stated in `structure.adl`.
- `get_stats` vector reporting uses the `depsInstalled()` capability probe, not `isVectorAvailable()` alone. It checks optional dependency imports and a real `better-sqlite3` `Database(':memory:')` binding, with no model load or DB side effects. `enabled = isVectorAvailable() || depsInstalled()`; true latches per process, false re-probes after self-heal. Do not revert to idle-only reporting. Pinned by `index.test.ts` and `embeddings.test.ts`.
- Multilingual expansion dedupes tokens through a `Set`; never add a dictionary entry whose value equals itself, or scoring double-counts. Pinned by `tfidf-multilingual.test.ts`.
- `get_memories_by_keys(summary=true)` stops the executive summary at the next `## ` heading, then applies the 500-character cap. Never drop the heading lookahead or section text bleeds into the injected index. Pinned by `query.test.ts`.
- Every vault-touching test file must hoist a `process.env.HOME` override before its imports; `paths.ts` captures the home directory at module load. Use the `vi.hoisted(...)` pattern.
- `org` tag routes to the shared vault
- `EXCLUDED_DIRS` in `src/paths.ts` skips `projects`, `templates`, `.obsidian`, etc. during vault scan
- `category` is derived from the first subdirectory under the vault root; files at vault root get category `knowledge`
- `slugify` (vault-scan.ts) collapses an empty or all-punctuation title to `''`, then falls back to the literal slug `'untitled'` (`slug || 'untitled'`) — without it an empty title would produce `knowledge/.md` with the path-shaped key `knowledge/`. Pinned by `slugify` tests in `vault-scan.test.ts`; never drop the `|| 'untitled'` fallback
- `journal` entries are auto-appended on `store_memory` only (personal memories only — org stores are skipped); `update_memory` and `delete_memory` do NOT write journal entries; never store to `journal` manually
- `since`/`before` date filters in `recall_memory` / `search_index` / `get_timeline` silently exclude memories with a missing `updated` field (by design); `list_memories` has no date filter
- `rebuild_index` preserves `accessCount`/`lastAccessed` — safe to run anytime
- Native-binding self-heal — a plugin update can leave `better-sqlite3` source-only. On first binding failure, `getDb` runs one in-process `npm rebuild` and retries. Never judge success from npm's exit code; the recorded error must say the binding is still missing and suggest a manual rebuild. If no plugin-local dependency is present, degrade silently. Pinned by `vectorStore` tests.
- `.mcp.json` must declare the `total-recall` stdio server; emptying it removes all tools while hooks continue. `install.sh` runs `claude mcp` commands from an empty temp folder and always removes with `-s user`; never reintroduce an unscoped remove. Pinned by `plugin-manifest.test.ts` and `hook-scripts.test.ts`.
- Tool errors are path-redacted — `wrapHandler` (`tools/registry.ts`) returns `Error: ${redactPaths(e.message)}` so EACCES/ENOENT text names `~` or `<org-vault>` instead of the user's home layout (`get_stats.recentErrors` already did this). `recordError` keeps the raw text for local debugging. That is why `[TR-S6]` reads "the registry depends only on State and Paths"; do not add other imports to the registry. Pinned by `registry-redaction.test.ts`.
- `upsertVector` performs `DELETE` then `INSERT`, never `INSERT OR REPLACE`; sqlite-vec's `vec0` table does not honor that on its primary key. Pinned against the real native modules by `vectorStore-reupsert.test.ts`.
- `store_memory(force=true)` supersedes rather than silently drops: it preserves `created`/`accessCount`, archives the prior body under `.superseded/`, and appends to `supersededAt[]`. It is refused for `no-prune` memories even with force. The archive write is best-effort. Pinned by `index.test.ts`.
- `no-prune` is opt-in per memory: excluded from prune candidates, refused by `delete_memory` unless force, and refused by `store_memory(force=true)`. Use `update_memory` to amend it. Pinned by `query.test.ts` and `index.test.ts`.
- Org memory author protection — both `store_memory` (even with `force=true`) and `update_memory` throw if the existing org memory's `author` field differs from the current OS user; personal memories have no author guard
- `personal` + `org` tags are mutually exclusive — `store_memory` throws if both are present on the same memory
- `update_memory` scalar-tags leniency: ignore a scalar `tags` argument and keep existing tags; a proper array replaces; omission keeps existing. Zod rejects scalars over MCP, but the internal import path bypasses Zod, so retain the coercion. Pinned by `index.test.ts` and `boundary-enforcement.integration.test.ts`.
- McpServer migration and schema parity: schemas are co-located with handlers, and `schema-parity.integration.test.ts` allows only documented cosmetic/additive deltas. Do not relax the normalizer to hide a real schema regression.
- `sessions` history in `update_memory` — deduplicated, capped at the last 50 entries; not replaced wholesale
- `contentCache` is an LRU (100 entries, 30-min TTL) — `recall_memory(full=true)` and `get_memories_by_keys` read through it; `update_memory` and `delete_memory` invalidate entries on write
- Build externalizes `@huggingface/transformers`, `sqlite-vec`, `better-sqlite3`, and `fsevents` — these must remain optional
- `category` is path-containment-checked — `store_memory` resolves `<vault>/<category>` and rejects values (e.g. `../../../tmp`) that escape the vault root; never trust `category` as a raw path
- `store_memory` rejects a personal memory whose `category` is `org` or any `org/`-prefixed value; the `org/` key prefix is reserved for the org vault. Check the prefix, not equality. Pinned by regression tests in `index.test.ts`.
- Org-author guard **ignores** the caller-supplied `author` for org memories — `effectiveAuthor` is always `os.userInfo().username` for org writes, so `author:'someone-else'` + `force:true` cannot overwrite another author's org memory
- Frontmatter rejects CR/LF in scalars and inline-array items, preventing key injection. Pinned by `frontmatter.test.ts`.
- `withExecutiveSummary` is idempotent; do not prepend a second header on update. Pinned by `frontmatter.test.ts`.
- `privacy-filter.ts` `safeStringify` returns `''` on circular references/BigInt instead of crashing open; named fields and the body are still scanned. Pinned by `sync-org-memory.test.ts`.
- `store_memory` rejects a personal memory with `category: 'org'` or an `org/` prefix; pinned by the exact/prefix cases in `index.test.ts`.
- Index files (`index.json`, `invertedIndex.json`) are written atomically via write-`.tmp` + `rename` — `persistence.ts` `atomicWrite()` (a thin wrapper over `src/atomic-write.ts` that routes failures to `recordError`); never write these files directly with a plain `writeFileSync`
- `flushPending` (the SIGTERM/SIGINT/beforeExit flush) gates the O(N) `recalcIdfNow` on `dirtyTokens || idfTimer !== null` — a pure read-only exit (only a `scheduleAccessSave` access-bump pending, zero token changes) runs `saveNow` to persist the access bump but SKIPS the inverted-index rebuild, since the inverted index already reflects `memIndex`'s tokens. The once-per-session rebuild backstop is preserved only when tokens changed or a recalc was already queued; never make `flushPending` unconditionally call `recalcIdfNow` again, or every read-only session pays a full `rebuildInvertedIndex` + `invertedIndex.json` write on shutdown.
- `index.json` has a **single-writer assumption** — no `flock`/CAS. Each Claude Code window spawns its own total-recall process; concurrent sessions both flush via `atomicWrite` and last rename wins. Disk-durable fields (`title`/`tags`/`content`/`sessions`) are re-derived from `.md` files on boot, so a clobber loses no memory content — only the runtime-only `accessCount`/`lastAccessed` (soft Ebbinghaus signals) can be reset. Don't run multiple heavy-write sessions in parallel if retention-decay accuracy matters
- SessionStart hooks emit `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":…}}` — omitting `hookEventName` silently drops the context (the plugin's core feature); JSON-encoding uses `node`, not `python3`
- 8.5: the two SessionStart hook manifests use a **per-client timeout field name** — `hooks.json` (Claude Code) and `hooks.gemini.json` (Gemini/Antigravity) both use `timeout` (ms). The field name is dictated by each client's hook schema, not a typo — do NOT "normalize" them away from what the client expects. When adding a new SessionStart/SessionEnd/PreCompact hook, mirror the existing per-manifest field for that client. The two manifests (`hooks/hooks.json`, `hooks/hooks.gemini.json`) are the ONLY hook sources — install.sh no longer embeds an inline copy (the `--standalone` path was removed).
- Frontmatter keys are escaped (`escapeRegExp`) before being interpolated into a RegExp in `frontmatter.ts` — a key is any `[^:\s]+` literal (incl. metacharacters; a teammate can push one via the shared org vault), so it must match literally; never interpolate a parsed key into `new RegExp` raw, or a key like `(a+)+` is mis-matched and an explicit `(a+)+: []` array is wrongly dropped
- The org `index.json` is the source of truth that `scripts/sync-org-memory.mjs` commits to the shared org-sync branch (`config.orgBranch`, default `knowledge`), so a corrupt parse must NOT be catch-wiped: `loadOrgIndex` throws when the file exists but is unparseable/non-object (interrupted `atomicWrite`, bad manual edit, merge-conflict marker) and the throw propagates to `main().catch` (logged to `~/.total-recall/org/.sync-errors.log`, exit 0), leaving the file untouched for manual recovery. Cold start (no `index.json` yet) returns `{}` — the first sync must be allowed to create it. The personal `index.json` is self-healing (rebuilt from `.md` files on boot); the org one is not.
- `reconcileIndex`'s walk catches `readdirSync` per directory. ENOENT (a dir gone since the walk scheduled it) skips silently, but a NON-ENOENT error (EACCES on a chmod'd subdir, EMFILE on fd exhaustion) is recorded via `recordError` (`reconcile readdirSync(<dir>): …`) so the subtree that just "vanished" from search is observable in `get_stats.recentErrors` instead of silently pruned — never wrap that readdirSync in a bare `catch { return; }` again, or an unreadable vault subdir becomes invisible with no signal.
- Git tests must not depend on the developer's `~/.gitconfig` — `sync-org-memory.e2e.test.ts` operates directly inside a local **bare** repo fixture (`remote.git`, its stand-in for a server-side remote), and a user-global `safe.bareRepository=explicit` (a common hardening setting against embedded-bare-repo attacks) makes every git command run with cwd inside it fail (`fatal: cannot use bare repository`). The suite therefore injects `safe.bareRepository=all` via git's env-config mechanism (`GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=safe.bareRepository`, `GIT_CONFIG_VALUE_0=all` in the test's `GIT_ENV`), which applies ONLY to processes the test spawns — the developer's global config and protection stay untouched. If you add another test that shells out to git against a bare fixture, reuse `GIT_ENV` (or the same env-config trio); never "fix" this class of failure by editing the user's global git config.
- `loadMemIndex` (`persistence.ts`) reads the personal `index.json` at boot with a try/catch. ENOENT is the expected cold start (no index.json yet — the first store creates it) and stays silent, but a NON-ENOENT failure (corrupt JSON from an interrupted `atomicWrite`, a bad manual edit, EACCES) is recorded via `recordError` (`loadMemIndex parse failed (rebuilding from .md files): …`). The personal index is self-healing (`reconcileIndex` rebuilds from the `.md` files), so it isn't data loss — but the silent discard would hide a real condition and the loss of the runtime-only `accessCount`/`lastAccessed` fields. Never collapse that catch back to a bare `catch { return; }`, or a corrupt index.json becomes invisible. (Distinct from the org-index guard in `sync-org-memory.mjs`, which THROWS on a corrupt committed index that propagates via git; this is local-only and benign.) Pinned by regression tests in `persistence-loadmemindex-error.test.ts` (parse + EACCES record, ENOENT silent).
- `shutdown()` (src/index.ts) is **idempotent via a module-level `shuttingDown` latch** (6.10) — the four exit triggers (`SIGTERM`, `SIGINT`, stdin `end`, stdin `close`) can fire concurrently (e.g. SIGTERM arrives while stdin is also closing, or a double signal); without the latch, `flushEmbeddings()`'s awaited drain and `process.exit(0)` could run twice and race. The latch is set at the top of `shutdown()` and the second-and-later calls return immediately. `flushPending()` (sync index write) runs first, then `await flushEmbeddings()` drains in-flight embed→upsert, then `process.exit(0)`. Never remove the latch or move `process.exit` outside the single-flight path, or a concurrent signal can exit before the flush completes. Pinned structurally by `index-stdin-end.test.ts` (asserts the `shuttingDown` guard exists in source) and dynamically by `src/__tests__/integration/shutdown-sigterm.integration.test.ts` (11.2: spawns real `dist/index.js`, stores a memory, SIGTERMs before the 1s `scheduleSave` debounce fires, and asserts the stored key lands in `index.json` on disk before exit — proving `flushPending` ran on SIGTERM; a second test fires SIGTERM+SIGINT in rapid succession and asserts clean exit 0 + index.json intact, pinning the latch's runtime contract).
- `store_memory` inputSchema declares `key`/`created`/`updated`/`sessions` (6.5) — the handler in `store.ts` already accepted these (the `import_memories` round-trip passes them to preserve the original key location and timestamps), but the schema omitted them, so a client had no way to pass them explicitly and they were undocumented. They are NOT required: a normal store derives the key from `title`/`category` and stamps `created`/`updated` from now; `sessions` is seeded from `sessionId`. Declaring them documents the restore path; do NOT make them required, or a normal `store_memory` call breaks.
- `rerank_memories` `keys` is capped at **200** (6.6) — the schema declares `maxItems: 200` and `rerank.ts`'s `MAX_KEYS=200` slices extras off the front (preserving original order) before the embed/score loop. The schema `description` notes the cap. An unbounded schema let a client pass thousands of keys, each costing an embed; never drop the `maxItems` or the `slice(0, MAX_KEYS)` guard.
- `delete_memories` `confirm` has **no default** (6.7) — it is `required` AND must be explicitly `true`. The schema previously declared `default: false` alongside the `required`, a contradiction (a required field has no default). The dead `default: false` was dropped; the handler still rejects `confirm !== true`. Never re-add a default to a required field.
- `export_memories` returns `{count, memories, errors}` (6.8) — an unreadable memory body (file deleted between list and read, EACCES, corrupt frontmatter) is NOT silently exported as `content: ''` (which `import_memories force=true` would then overwrite real content with). Instead the entry is `{key, error: 'unreadable or missing memory file'}` and counted in `errors`; `import_memories` skips any entry carrying an `error` field so the round-trip can't clobber a live memory with an empty body. Never collapse the error entry back to a bare `''` export, or a failed read becomes a destructive import.
- `delete_memories` records a reserved key as a **per-key error, not a batch reject** (6.9) — the up-front `keys.some(isReservedKey)` throw was dropped. Now the per-key loop's `deleteMemory` catch records a reserved (`no-prune` without `force`) key in `errors` like every other per-key failure, and the rest of the batch proceeds (deleted count reflects only the keys actually removed). A single reserved key no longer aborts the whole batch. The `isReservedKey` import was removed from `bulk.ts` (no longer used); do NOT re-add the up-front throw. Pinned by `bulk.test.ts` (6.9) and `reserved-keys.test.ts` (updated from the old batch-reject contract to the new per-key contract).
- Personal-vault durability: the `.md` files are the only copy of memory content. `install.sh` initializes a local-only git repo; `session-end.sh` auto-commits it, never initializes one, and never adds a remote. A `pre-push` hook blocks pushes, and `.superseded/`, `*.tmp.*` and `vectors.db*` are gitignored. Pinned by `hook-scripts.test.ts`.
- SessionEnd emits `{"continue":true}`, not `hookSpecificOutput.additionalContext`; the latter is invalid for teardown and was failing silently. Pinned by `hook-scripts.test.ts`.
- Org working-tree wipe tripwire: `sync-org-memory.mjs` `guardTreeWipe()` snapshots `.md` counts around the tree-mutating `git switch`; if a non-empty tree collapses to zero while HEAD has files, it restores from HEAD and throws. Pinned by `sync-org-wipe-guard.test.ts`.
