# Backlog — deferred / by-design items

Single, searchable home for review items that are **not** going to be coded right
now, with the reason and the trigger that would reopen each. Keeping these here
(instead of as scattered TODO comments that rot) makes the active review set
unambiguous and lets a future pass triage in one place.

Status legend: **DEFERRED** (real work, waiting for a trigger) · **DECIDED**
(documented as by-design, no change intended) · **DONE** (landed, kept for
reference). Source review files were removed when the `reviews/` folder was
pruned (2026-07-29); this backlog is now the sole record.

---

## DEFERRED — waiting for a trigger

### Load test 20k (10k personal + 10k org) — ADD→SEARCH→DELETE — perf bug found & fixed · **DONE**
- **Source:** `plugins/total-recall/scripts/loadtest.ts` (throwaway-HOME driver,
  TF-IDF-only); run 2026-07-30. Real vaults untouched — byte-identical `diff -r`
  vs pre-flight snapshots; live `get_stats` 523 personal unchanged; org git log
  clean (the driver imports `src/tools/*` directly via tsx in
  `HOME=/tmp/tr-loadtest`, so the MCP server and the PostToolUse org-sync hook
  never fire — no junk commits pushed).
- **What (the bug):** burst-write throughput collapsed quadratically — ADD
  206/s → 23/s as N grew 2k→20k (20k in 881s), DELETE ~34/s. The O(N²) lived in
  `registerDocument` (`src/tfidf.ts`), called on EVERY store/update/delete:
  (1) `deregisterDocument` scanned ALL active terms' posting lists and rebuilt
  each via `.filter` even for a brand-new key whose postings don't exist — O(T),
  T≈active terms; (2) a per-store global IDF recalc loop recomputed `idf` for
  every active term — O(T). Both O(T)≈O(N) per mutation → O(N²) over a burst.
  (The earlier hypothesis blaming the debounced `recalcIdfNow` was wrong: the
  debounce *prevents* repeated rebuilds, and during a tight synchronous loop the
  1s/2s timers can't even fire — the event loop is blocked.) DELETE's O(T)
  `deregisterDocument` scan was the symmetric half.
- **Fix (landed, `src/tfidf.ts`):** `deregisterDocument` now uses a per-doc term
  set (`docTerms`) to touch ONLY the doc's own terms — O(unique-terms-in-doc) —
  with a full-scan fallback for untracked keys; `registerDocument` skips deregister
  for genuinely-new keys and drops the global IDF loop, computing `idf` **live
  per query token** in `tfidfSearch` from live `df` + `N` (O(Q), always correct,
  no stale cache); an O(1) `indexedDocCount` counter replaces the O(N)
  `Object.keys(memIndex).length` in the per-store path.
- **Result (re-run, same TF-IDF-only conditions):** ADD now **flat at ~2200/s**
  (2192→2243, zero degradation; 10k in 6.2s at 1621/s avg — ~70× the old 23/s);
  SEARCH p50 87ms / p95 93ms, persisted reload 20/20 hits; DELETE 79/s (was 34/s
  at 20k) — now I/O-bound (per-delete org-author file read + `deleteVector` sqlite
  open + unlink), a constant not algorithmic. Full suite 731/731 pass; typecheck
  clean. Residual DELETE cost is per-delete file I/O, not a scan.
- **Reuse:** `scripts/loadtest.ts` stays as the reusable harness —
  `HOME=/tmp/tr-loadtest LT_N=… npx tsx scripts/loadtest.ts`; rename
  `@huggingface/transformers` → `.disabled-loadtest` for an apples-to-apples
  TF-IDF-only run and pass `hybrid:false` to `recall_memory` (restore the package
  after). Its `VERIFY` line reports FAIL on the engine-auto-created
  `journal/<date>.md` — a known false alarm (residual-by-tag is 0), not a real
  failure.

### vault-scan dir-mtime cache (review item 9.1)
- **Source:** `review-synthetized-25072026.txt` §9.1.
- **What:** `reconcileIndex` re-walks every directory on each poll even when only
  files changed. A per-directory mtime cache (skip a subtree whose dir mtime is
  unchanged) would cut the walk cost.
- **Trigger:** vault grows into the thousands of memories (today it's personal
  scale — sub-ms walks; the win is negligible and the correctness risk of a
  missed subdir is real).
- **Shape when picked up:** cache dir mtime alongside the file index in
  `src/vault-scan.ts`; invalidate on any write. Re-run Stryker — vault-scan is
  the highest-coverage file (82.3%), a regression there is visible.

### Mutation-coverage survivors: persistence / vectorStore / embeddings
- **Source:** `stryker-mutation-audit-26072026.md`; current scores in
  `reports/mutation/mutation.html` (gitignored).
- **What:** real mutation score is 68.28% (1231/1803), above the 65% break gate.
  The lowest modules are `embeddings.ts` (44.0%), `lru-cache.ts` (48.1%),
  `journal.ts` (37.5%), `vectorStore.ts` (55.1%, 96 NoCoverage — native
  better-sqlite3/sqlite-vec boundary), `persistence.ts` (58.9%).
- **Trigger:** next deliberate mutation-hardening pass. The native-boundary
  NoCoverage in vectorStore/embeddings is partly structural (mocked in tests,
  so the real code path is NoCoverage under Stryker) — prioritize
  `persistence.ts` (103 survivors, pure logic) first.
- **Shape when picked up:** one targeted test file per module, same pattern as
  `vault-scan-reconcile.test.ts`. Re-run `npm run mutation` and update the
  audit file with the new per-module table.

### Ollama + local embedding-model path (minimax family)
- **What:** proposals for an Ollama-backed local embedder / local-first inference
  path. Currently the embedder is a local in-process HuggingFace MiniLM; Ollama
  is supported as a *client* (the vault works regardless of backend) but not as
  an embedder.
- **Trigger:** explicit need for a local, non-HuggingFace embedding source
  (e.g. minimax-family models via Ollama).
- **Shape when picked up:** pluggable embedder behind the existing `embed()`
  seam in `src/embeddings.ts`; config-selected. Pin dim-mismatch guards
  (vectorStore 3.1/3.2) against the new model's dim.

### Langfuse observability / tracing
- **Source:** `review-implement-langfuse-25072026.txt`.
- **What:** Langfuse SDK instrumentation for tool-call tracing + eval experiments.
  Not a dependency today.
- **Trigger:** prod observability / experiment-tracking need. This is a
  single-user local-memory plugin today, so tracing infra is premature.
- **Shape when picked up:** optional SDK import gated on a config flag so it
  stays zero-cost when off; instrument the `wrapHandler` boundary in
  `src/tools/registry.ts` (one span per tool call). See the review file for the
  full plan.

### index.json has no lock (single-writer assumption)
- **Source:** `ARCHITECTURE-REVIEW-TODO.md` item 1 (file pruned 2026-07-28).
- **What:** `index.json` is written under a single-writer assumption. Concurrent
  Claude Code windows can clobber runtime-only fields (`accessCount`,
  `lastAccessed`).
- **Trigger:** multi-window concurrent use becomes routine (today the process is
  single-instance per user session).
- **Shape when picked up:** advisory lock or merge-on-read for the runtime-only
  fields, so a stale writer can't overwrite a fresher access record.

### Embedding provider is a hardcoded if/else
- **Source:** `ARCHITECTURE-REVIEW-TODO.md` item 2 (file pruned 2026-07-28).
- **What:** `src/embeddings.ts` selects the provider via a hardcoded if/else,
  blocking the addition of OpenAI/Voyage/Cohere/Ollama embedders without
  touching core logic.
- **Trigger:** a second embedding backend is needed (e.g. the Ollama/local path
  above, or a hosted provider).
- **Shape when picked up:** extract an `EmbeddingProvider` interface + registry
  map behind the existing `embed()` seam. Pin vectorStore 3.1/3.2 dim-mismatch
  guards against the new provider's dim.

### Org-sync freshness relies on marker-file polling
- **Source:** `ARCHITECTURE-REVIEW-TODO.md` item 5 (file pruned 2026-07-28).
- **What:** teammate memories can lag until the next poll/hook fires — there is
  no push path.
- **Trigger:** team-shared org-vault usage where staleness is felt (banking
  deployment target). Pairs with the banking-readiness org-sync hardening.
- **Shape when picked up:** optional `fs.watch`-based fast path, falling back to
  polling on network filesystems where inotify isn't reliable.

### No schema-version marker in index.json/frontmatter
- **Source:** `ARCHITECTURE-REVIEW-TODO.md` item 6 (file pruned 2026-07-28).
- **What:** `index.json` and the frontmatter format carry no `indexVersion` /
  schema marker, so a future breaking format change has no clean migration hook.
- **Trigger:** an `index.json` or frontmatter format change that would break old
  vaults silently.
- **Shape when picked up:** add `indexVersion`, checked at `loadIndexes()` to
  trigger a rebuild rather than reading a stale-shape index.

### state.ts global singletons couple tools/* to one process
- **Source:** `ARCHITECTURE-REVIEW-TODO.md` item 7 (file pruned 2026-07-28).
- **What:** `state.ts` global singletons couple the whole `tools/*` layer to one
  process, blocking any future multi-tenant/worker-pool design.
- **Trigger:** scope grows beyond single-user (multi-tenant SaaS, worker pool).
- **Decision shape:** acceptable now for a personal-use tool; flagged here so a
  future scope change triages it deliberately instead of rediscovering it.

### Context graph / temporal relations over memories (Technology Radar Vol 34)
- **Source:** Thoughtworks Technology Radar Vol 34 (2026) — *Context graph*
  (Assess technique) and *Graphiti* (Trial platform, Zep's open-source
  bi-temporal knowledge-graph engine). See org memory
  `org/knowledge/thoughtworks-technology-radar-vol-34-2026-adopt-trial-synthesis`.
- **What:** the plugin has a *supersede* primitive (`store_memory force=true`
  archives the prior body + appends a `supersededAt[]` chain — CLAUDE.md, and
  `supersededAt` in `store.ts`/`frontmatter.ts`) but no queryable relation/graph
  layer: `get_related_memories` is Jaccard tag-overlap only, not typed edges or a
  validity-window/relation graph. A context-graph layer would let recall answer
  "what did I believe about X and when / what superseded what" as structured,
  queryable data rather than tag co-occurrence.
- **Trigger:** a concrete need to traverse memory relations (decision → revised-by,
  fact → invalidated-by) beyond tag similarity — e.g. an ADR-history view. The
  existing `supersededAt` chain already stores the raw temporal edges, so the
  data is half-present.
- **Shape when picked up:** a full bi-temporal validity-window + relation/graph
  layer is explicitly an *assess-level experiment*, not a committed change (per
  the CLAUDE.md supersede gotcha). Start read-only: a tool that walks the
  `supersededAt` chain for a key; only then consider typed edges. Keep it
  optional/local — do NOT pull in a graph DB (would violate the one-hard-dependency
  design philosophy).

### LLM-driven source-grounded extraction for the PreCompact hook (Technology Radar Vol 34)
- **Source:** Thoughtworks Technology Radar Vol 34 (2026) — *LangExtract* and
  *Docling* (both Trial, Languages & Frameworks); *Structured output from LLMs*
  (Adopt technique). See the Radar org memory above.
- **What:** `hooks/scripts/extract-and-store-memories.sh` already asks the model
  for structured JSON lines (0–3 learnings) and `store-learning.mjs` writes them
  as `.md` files — this is already the *structured output* pattern. What's missing
  is **source grounding**: each auto-captured learning is stored with no link back
  to the transcript span it came from, so a later reader can't verify or trace it.
- **Trigger:** auto-captured PreCompact memories are found to be unverifiable /
  hallucinated and provenance is wanted; or the extraction quality needs an
  objective harness (pairs with the eval entry below).
- **Shape when picked up:** have the extraction prompt emit, per learning, a short
  verbatim source quote or transcript offset (LangExtract's source-traceability
  idea), stored in frontmatter (e.g. `sourceSpan`). Keep it a plain prompt+JSON
  contract — do NOT add the LangExtract/Docling Python deps; the value is the
  *technique* (grounded structured output), not the library, in a Node/no-heavy-dep
  plugin.

### Evaluation harness for MCP tool / recall quality (Technology Radar Vol 34)
- **Source:** Thoughtworks Technology Radar Vol 34 (2026) — *DeepEval* (Trial,
  Languages & Frameworks), which now evaluates agentic/multi-turn workflows
  including **MCP-server interactions** (tool correctness, step efficiency, task
  completion). Pairs with the existing **Langfuse observability** DEFERRED entry
  above. See the Radar org memory above.
- **What:** there is no automated eval of retrieval quality (does `recall_memory`
  return the right memory for a query?) or tool correctness. An earlier eval
  harness was removed as non-essential; this reopens the *idea* at a scoped,
  Radar-endorsed altitude rather than the old harness.
- **Trigger:** a scoring change (Ebbinghaus λ, TF-IDF boosts, RRF k, multilingual
  expansion) needs a regression guard, or recall quality is questioned and there's
  no objective signal. Explicitly premature for a single-user local plugin today.
- **Shape when picked up:** a small offline eval set (query → expected-memory-key)
  scored against `recall_memory`/`search_index` as a golden test; only reach for
  DeepEval if agentic/multi-turn MCP-interaction metrics are actually needed. Keep
  it a dev-only harness (not shipped in `dist/`), same as the mutation tooling.

### Org-sync branch-default divergence on detached HEAD (pull vs sync)
- **Source:** `REVIEW-bugfix-proposals-30072026.md` Fix 3 (proposal file deleted
  after triage; this entry is the record).
- **What:** `hooks/scripts/pull-org-vault.sh:7` defaults `BRANCH="knowledge"`
  (overridden only by `config.orgBranch`); `scripts/sync-org-memory.mjs:54`
  defaults `BRANCH = config.orgBranch || detectOrgBranch() || 'org-vault'`. In
  steady state `detectOrgBranch()` reads the checked-out branch back so they
  agree. When `config.orgBranch` is unset **and** the org checkout is on a
  detached `HEAD`, `detectOrgBranch()` returns `''` (`sync-org-memory.mjs:49`,
  `b !== 'HEAD'`), so sync falls back to the literal `'org-vault'` while pull
  keeps refreshing `knowledge` → `git switch org-vault` fails (no local branch;
  pull never created it) → sync returns early → **org writes silently stop
  pushing**. The two literals differ on purpose (`knowledge` = production
  default, `org-vault` = e2e fixture branch), so they can't simply be aligned.
- **Trigger:** detached-HEAD org checkout with `config.orgBranch` unset.
  Medium-low, latent — `detectOrgBranch()` masks it in the attached-HEAD steady
  state. Independent of the DEFERRED *Org-sync freshness relies on marker-file
  polling* entry (BACKLOG.md:89-96) — this is a correctness fix, that one is a
  latency feature; do not merge them.
- **Shape when picked up:** in `detectOrgBranch()`, on detached HEAD fall back to
  the remote's default branch via `git symbolic-ref --short refs/remotes/origin/HEAD`
  (pull's `git clone --branch` sets it up), stripping the `origin/` prefix, before
  the `'org-vault'` last-resort literal. Preserves the `org-vault` e2e fallback
  (where `origin/HEAD` → `org-vault` anyway). Pin in
  `sync-org-memory-hook.test.ts`: detached HEAD + `origin/HEAD` →
  `origin/knowledge` + unset `config.orgBranch` → sync targets `knowledge`.

### `config.orgVault` change without restart silently stops org sync
- **Source:** `REVIEW-bugfix-proposals-30072026.md` Fix 4 (proposal file deleted
  after triage; this entry is the record).
- **What:** `src/paths.ts` resolves `ORG_VAULT` once at module load from
  `loadConfig()` (the exported const is fixed for the process lifetime);
  `src/tools/store.ts` writes org memories to that frozen value. The
  short-lived `scripts/sync-org-memory.mjs:23-26` re-resolves its **own**
  `ORG_VAULT` from `loadConfig()` on every invocation. After a user edits
  `config.orgVault` without restarting the MCP server, `store_memory` keeps
  writing to the **old** path while the next sync reads the **new** path, finds
  no file (`fs.existsSync` false), and exits 0 → **org writes silently stop
  syncing** until the server restarts. Config-restart hygiene gap, not a crash.
- **Trigger:** `config.orgVault`/`personalVault` edited at runtime without an
  MCP-server restart. Low, latent.
- **Shape when picked up:** Option A (cheapest) — document in the config section
  of `plugins/total-recall/README.md` / `CLAUDE.md` that changing
  `orgVault`/`personalVault` needs an MCP-server restart for the write path to
  pick it up (hooks already re-read config per invocation; only the long-lived
  server is stale). Option B (robust) — resolve `ORG_VAULT`/`PERSONAL_VAULT`
  dynamically at use time in `store.ts`/`mutate.ts` instead of importing the
  module-load const. Adjacent to but **not** fixed by the DEFERRED *No
  schema-version marker* entry (BACKLOG.md:98-105) — a schema marker triggers an
  index rebuild, not a vault-path re-resolve; keep them separate.

> Items 4 (server.ts monolith) and 8 (deprecated `Server` class) from the
> pruned `ARCHITECTURE-REVIEW-TODO.md` are **DONE** — the McpServer migration
> (CLAUDE.md 6.1-6.3) co-located schemas with implementation in `tools/*.ts`
> and replaced `new Server(...)` with `McpServer` + `registerTool()`. Item 3
> (vault-scan dir-mtime) is the first DEFERRED entry above.

---

## DECIDED — documented as by-design, no change intended

### rerank silent degradation (no-embedder → score 0, original order)
- **Source:** `review-synthetized-25072026.txt`; contract comment in
  `src/tools/rerank.ts` (1.0.133).
- **Decision:** "always answer" policy shared with `recall_memory` — a missing
  embedder returns the full candidate set at score 0 rather than dropping it or
  throwing. Silent degradation is intentional; memory recall must never return
  nothing because the embedder is absent.

### auto-reconcile 10s poll (no fs.watch)
- **Source:** `review-synthetized-25072026.txt`; contract comment in
  `src/auto-reconcile.ts` (1.0.133).
- **Decision:** fixed 10s poll instead of `fs.watch`. The reconcile marker is
  written by a *separate* hook process; `fs.watch` only delivers in-process
  events for files/parents that exist when the watcher is attached and offers no
  cross-process guarantee. `reconcileIndex` is mtime-cached so the no-op poll is
  O(1); the only cost is ≤10s latency, acceptable for a background reconcile.

---

## DONE — landed, kept for cross-reference

- **Multilingual query expansion double-counted duplicate tokens** (v1.1.17) —
  `tfidfSearch`'s bilingual expansion now dedupes via a `Set`, preserving
  first-seen order so the title/tag boost path still sees each distinct token
  once. The dict is bidirectional (17 of 28 entries map both ways), so
  `"decizie decision"` expanded to `['decizie','decision','decision','decizie']`
  and the per-token scoring loop inflated a matching doc ~2× over its
  monolingual baseline. **The original entry graded this "low severity (gated,
  default off)" — that was stale**: the maintainer's own
  `~/.total-recall/config.json` sets `enableMultilingualSearch: true`, so it was
  live in production. Also removed the `'concept': 'concept'` **self-mapping**
  from `BILINGUAL_DICT` — a key whose value equals itself double-counted on a
  PLAIN single-word query with no mixed-language input at all, which the
  original triage missed. Pinned by the `dedupe prevents double-counting`
  describe block in `tfidf-multilingual.test.ts` (2 tests, verified to fail
  against the pre-fix expansion).
- **`get_memories_by_keys(summary=true)` exec-summary bled past the section
  boundary** (v1.1.17) — `src/tools/query.ts` now captures lazily with a
  `(?=\n##\s|\n*$)` lookahead and re-applies the 500-char cap. The prior greedy
  `[\s\S]{0,500}` had no stop at the next `## ` heading, so the COMMON case (a
  short summary, given `withExecutiveSummary`'s
  `## Executive Summary\n\n<summary>\n\n## <next>` layout) swallowed the
  following section's heading + body up to the cap. That text is surfaced in the
  SessionStart injected index, so every session paid tokens for the leak. Legacy
  headerless bodies still fall back to `slice(0,500)`. Pinned by the
  `summary=true exec-summary extraction` describe block in `query.test.ts`
  (4 tests: bleed / trailing-last-section / legacy-fallback / 500-cap).
- **`embeddings.test.ts` read the developer's real `~/.total-recall/config.json`**
  (v1.1.17) — it was the only vault-touching test file with no hoisted
  `process.env.HOME` override, so `paths.ts` (which captures `os.homedir()` once
  at module load) resolved the real home and the load-failure warning named
  whatever `embeddingModel` that machine had configured. Read-only, but it made
  test output vary per developer and left any future assertion on the model name
  latently flaky. Fixed with the same `vi.hoisted` pattern the other 20 files
  use; the warning now names the tmp HOME and the default model. Nothing in the
  file needed a real HOME — the HF pipeline and `vectorStore` are both fully
  mocked, so only `loadConfig()` read it.
- **Multilingual RO/EN excluded from Stryker** — bilingual dict + expansion
  branch wrapped in `// Stryker disable all`; toggling tests split into
  `tfidf-multilingual.test.ts` (out of the Stryker allow-list). `7d978a7`.
- **Real mutation score ≥65%** — 59.51% → 68.28% via `vault-scan-reconcile.test.ts`
  (47 tests); break gate at 65 in `stryker.conf.json`; CI mutation workflow.
  `7d978a7`.
- **Copilot CLI removal completed** — code removed earlier; docs + install.sh
  cleaned in `ee0cde5` (1.0.133). No Copilot references remain.
- **C-1 message honesty** — `vectorStore.ts` error messages corrected to match
  actual `rebuild_index` behavior; pinned in `vectorStore.test.ts`. `ee0cde5`.
- **C-1 behavior fix — bulk re-embed after a model switch** — `rebuild_index`
  gained an opt-in `forceReembed` flag (default false) backed by a dedicated
  `reembedAll()` in `src/tools/mutate.ts`: drops `vec_memories`, re-embeds every
  memory at the current model's dim via a bounded queue
  (`REEMBED_CONCURRENCY=8`, full content through `readCachedOrFresh`, awaited
  upserts + `flushEmbeddings` for a truthful count), and refuses without dropping
  when `embed()` returns null. Not a bare drop→`reconcileVectors` (that path is
  fire-and-forget, unbounded, and embeds `contentPreview` not full content).
  Pinned by `src/__tests__/rebuild-index-reembed.test.ts` (5 tests).
  `1.0.135`.