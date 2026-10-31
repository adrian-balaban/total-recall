# 📋 Backlog — deferred / by-design items

Single, searchable home for review items that are **not** going to be coded right
now, with the reason and the trigger that would reopen each. Keeping these here
(instead of as scattered TODO comments that rot) makes the active review set
unambiguous and lets a future pass triage in one place.

Status legend: **DEFERRED** (real work, waiting for a trigger) · **DECIDED**
(documented as by-design, no change intended). Finished items are removed. Source review files were removed when the `reviews/` folder was
pruned (2026-07-29); this backlog is now the sole record.

---

## ⏸️ DEFERRED — waiting for a trigger

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

### Bounded concurrency for `embedAndUpsert` (tried in 1.3.3, backed out)
- **What:** `store.ts`/`mutate.ts` call `embedAndUpsert` fire-and-forget, one embed
  + one sqlite write per memory with no limit. A bulk import or a burst of stores
  runs them all at once (the re-embed path already has `REEMBED_CONCURRENCY=8`).
- **Tried:** a FIFO limiter (2 slots, slot released in `finally`, `flushEmbeddings`
  still waiting for queued jobs). Its unit tests passed, but with it in place the
  Stryker dry run aborted its test child process (`SIGABRT`, `Napi::Error`) in 3 of
  3 runs, while `origin/main` was clean in 3 of 3. The most likely cause: a failed
  model load is deliberately not cached, so a queued burst retries the failing
  native load one job after another instead of sharing one in-flight attempt.
- **Trigger:** a real report of a bulk store/import saturating the embedder or
  sqlite, or when the load path is changed to share one in-flight load attempt.
- **Shape when picked up:** share the in-flight load promise (and cache a negative
  result for a short TTL) first; then add the limiter. Re-run the Stryker dry run
  3x before merging, since the abort is intermittent under plain vitest.

### Atomic writes for memory `.md` files
- **Source:** `ADL-EXPANSION-PLAN.md` (Rejected or deferred; file deleted 2026-10-31).
- **What:** memory `.md` files are written with plain `writeFileSync` in
  `store.ts` and `mutate.ts`. Only the index files are written atomically
  (`persistence.ts` `atomicWrite()`), so any "all vault writes are atomic" rule
  would fail today. The ADL plan defers it as a design decision and scopes
  `[TR-W1]` to the index files only.
- **Trigger:** deciding whether `.md` writes should go through `atomicWrite`
  (for example after a report of a truncated memory file after a crash).
- **Shape when picked up:** record the decision as an ADR; if accepted, route the
  `.md` writes through `atomicWrite` and add the ADL assertion with its test.

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
  bi-temporal knowledge-graph engine). 
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
- **Partly started (2026-10-27):** `scripts/eval/spec-eval.ts` evaluates the
  spec-driven tools (decision@1 per element, rule recall, trace hit rate, stale
  decisions) on a corpus of ADL projects; `spec-eval.test.ts` runs it on a
  generated corpus in CI. Generic `recall_memory` quality is still not evaluated.

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
  module-load const.

### `GEMINI.md` duplicates `CLAUDE.md` rules
- **Source:** the removed `NON-ESSENTIAL-ANALYSIS.md`.
- **What:** `plugins/total-recall/GEMINI.md` repeats "always-true" rules from
  `CLAUDE.md` and install/compat text from the READMEs, so it can drift.
- **Trigger:** the next edit to either file, or a Gemini/Antigravity-specific change.
- **Shape when picked up:** reduce `GEMINI.md` to Gemini/Antigravity-only notes and link to
  `CLAUDE.md`, or fold it into the README compatibility notes.

### Two hook manifests kept in sync by hand
- **Source:** the removed `NON-ESSENTIAL-ANALYSIS.md`.
- **What:** `hooks/hooks.json` and `hooks/hooks.gemini.json` must be edited
  together (`CLAUDE.md` says so). Nothing fails if they diverge.
- **Trigger:** any new hook (the spec-driven plan adds three), or dropping
  Gemini/Antigravity support.
- **Shape when picked up:** a unit test asserting the two list the same events
  and scripts, or generate one from the other.

---

## ✅ DECIDED — documented as by-design, no change intended

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
