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
- **Source:** `ollama-minimax-proposals.md`, `review-ollama.txt`,
  `REVIEW-ollama-glm-5.2.txt`.
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