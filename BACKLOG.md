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

### Multilingual query expansion double-counts duplicate tokens
- **Source:** `REVIEW-bugfix-proposals-30072026.md` Fix 1 (proposal file deleted
  after triage; this entry is the record).
- **What:** `src/tfidf.ts:159-167` — `tfidfSearch`'s bilingual expansion pushes
  each query token plus its translation, but the dict is bidirectional (RO→EN
  *and* EN→RO), so a query containing a word **and** its translation produces
  collisions: `"decizie decision"` →
  `['decizie','decision','decision','decizie']`. The scoring loop
  (`tfidf.ts:189-216`) adds each doc's score once per token, so a doc matching
  `decizie` gets its `(1+log tf)·idf ·boost` added twice → ~2× inflation vs. the
  monolingual baseline. An artifact of the translation step, not genuine
  query-term frequency.
- **Trigger:** any user enabling `config.enableMultilingualSearch` and issuing a
  mixed-language query. Low severity today (gated, default off, Stryker-excluded
  so lightly tested), but a trivial fix worth pinning.
- **Shape when picked up:** dedupe `tokens` after expansion (preserve first-seen
  order so the title/tag boost path sees each token once). Pin in
  `tfidf-multilingual.test.ts`: query `"decizie decision"` against a
  single-`decizie` doc must score equal to the monolingual `"decizie"` query.

### `get_memories_by_keys(summary=true)` exec-summary capture bleeds past the section boundary
- **Source:** `REVIEW-bugfix-proposals-30072026.md` Fix 2 (proposal file deleted
  after triage; this entry is the record).
- **What:** `src/tools/query.ts:82` — the regex
  `/^## Executive Summary\n+([\s\S]{0,500})/m` captures up to 500 chars after the
  header with **no stop at the next `## ` heading**. `withExecutiveSummary`
  (frontmatter.ts) lays the body out as `## Executive Summary\n\n<summary>\n\n## <next>…`,
  so a short summary (the common case) swallows the following section's heading
  line + body up to the 500-char cap, leaking the next section into the
  `summary` field of the injected index / any rendering UI.
- **Trigger:** surfaced as a quality issue in summaries; low severity, no
  correctness impact on search.
- **Shape when picked up:** lazy capture with a `(?=\n##\s|\n*$)` lookahead, then
  cap to 500: `body.match(/^## Executive Summary\n+([\s\S]*?)(?=\n##\s|\n*$)/m)`,
  falling back to `body.slice(0,500)` for legacy bodies lacking the header. Pin
  with a body `## Executive Summary\n\nshort.\n\n## Details\n\nlong…` asserting
  `summary === "short."` and no `## Details`.

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