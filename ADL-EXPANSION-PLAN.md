# 📐 Plan: more ADL for Total Recall, from the Neal Ford masterclass

Status: **proposal**, nothing implemented yet. Date: 2026-10-29.

Sources merged here:

- **Review A** (pasted): `contracts.adl`, `workflows.adl`, `capabilities.adl` plus extensions, IDs C/W/P.
- **Review B** (pasted): six files, `tool-contracts`, `lifecycle-sagas`, `durability`, `security-containment`, `observability`, `architecture-style`, IDs C/G/H/V/O.
- **Own review**: the 18 Make the Grade exercises in `../../masterclassNealFord@026` (pages 28-74), checked against `plugins/total-recall/` at commit `6fee5a4`.

Every claim below was checked against the code. Where a claim was checked only at file level (the test file exists, the exact `it()` has not been picked yet), the table says so.

---

## ⚡ TL;DR

- Add **3 new ADL files** (`contracts.adl`, `workflows.adl`, `capabilities.adl`) and **1 descriptive file** (`architecture-style.adl`, untagged). Extend `data-governance.adl`, `structure.adl`, `code-quality.adl` and `runtime-safety.adl`.
- New ID letters: **C** (contracts), **W** (workflows and sagas), **P** (operational capabilities). Keep S, R, D and Q. That makes 3 new letters, not Review B's 5.
- That adds **34 tagged assertions** (19 → 53). Of these, **21 only retag existing tests**, **12 need a new small test**, and **1 is fitness-first** (`it.fails` until the 1.4.0 org-injection work lands).
- Ship it in **4 PRs**: retag only, then new fitness rules, then the descriptive file, then the 1.4.0 flip.
- **Rule for what goes in:** ADL holds rules about the architecture, not a list of unit behaviours ("an ADL file states rules, not a list of tools"). Several items from both reviews stay as plain unit tests (see [Rejected](#-rejected-or-deferred)).

---

## 🔍 Review of the two proposals

### What the code says

| Claim | Source | Verdict |
|---|---|---|
| `adl-parse.ts` drops `including {…}` continuation lines, so avoid them | B | ❌ **Wrong.** `adl-parse.ts` appends an indented line that starts in lowercase to the previous `DEFINE CONTRACT` (`lastDef`). `including {…}` parses and lands in `doc.other` = 0. |
| The parser supports `CONTRACT … BETWEEN`, `TYPE`/`CAPABILITY`, `DEFINE CAPABILITY … FOR`, `SAGA` + `COORDINATION`/`CONSISTENCY`, `STYLE` | A | ✅ Correct (`VALUE_KINDS`, `PROPERTY_KINDS`, `HEADER_RE`). |
| "Only 19 of ~35 invariants have `[TR-…]` assertions"; "19 → 42 covers 100% of Key Invariants" | A | ⚠️ **Overstated.** The Key Invariants table in `ARCHITECTURE.md` has **19 rows**. There are also 19 tagged assertions today, but they are not the same 19. |
| "Every proposed assertion already has a passing test" | A | ❌ False for `[TR-S10]`, `[TR-S11]` (new ArchUnit rules needed) and for the manifest-version rule: `plugin-manifest.test.ts` does not check versions. Today only CI's `git diff --exit-code` after `sync:version` enforces it. |
| `memory-archive` contract `BETWEEN {MCP Stdio Server, Tools}` | A | ❌ Tools run inside the server, so this is not a boundary. The real tolerant-reader boundary is the **memory file format**, which the server, the bash hooks and teammates on other plugin versions all share (see `[TR-C6]`). |
| `DEFINE CONST MAX_CACHE_ENTRIES = 100` | A | ⚠️ No assertion uses it. Drop it. |
| Search (`tfidf`, `ebbinghaus`, `rrf`) has no dependency on Vectors or Persistence | A | ✅ Holds today: `tfidf.ts` imports only `ebbinghaus`, `state`, `paths`. |
| `bulk.ts` / `architecture.ts` use only `store`, `mutate` and `registry` among tools | A | ✅ Holds (`bulk` → store, mutate, registry; `architecture` → store, mutate, registry). |
| `system.adl` landscape is pinned to 5 elements; COMMUNICATION endpoints must resolve to exactly one element; shared elements must match name and kind | B | ✅ Correct (`adl-consistency.test.ts`). |
| Registry wraps every tool with a perf sample and an error record | B | ✅ `tools/registry.ts` (`recordPerfSample`, `recordError`, `redactPaths`). No test pins the perf sample yet, so it needs a **new test**. |
| Untagged assertions cost no test debt | B | ✅ `adl-coverage.test.ts` and `indexer.ts` check tagged IDs only; untagged ones get an `A-<hash>` ID and are still indexed. |
| `rerank` caps at 200 and keeps order; `sessions` capped at 50 and deduplicated | A, B | ✅ `MAX_KEYS = 200` with `slice(0, MAX_KEYS)`; `mutate.ts` `[...new Set(…)].slice(-50)`. |

### What both reviews miss (from the masterclass)

| Course page | Idea | Where it lands here |
|---|---|---|
| 30-31 `test-quality.adl` | "Agents may not make a build green by weakening tests": no assertion-free tests, no tautologies | `[TR-Q4]`, `[TR-Q5]`, and the Stryker break gate `[TR-Q6]` |
| 47-48 `guardrails.adl` | Central guardrails: dependency audit, a gated release | `[TR-Q7]` audit gate, `[TR-Q8]` release only from a green gate |
| 52-53 | Write the fitness function **before** the code | `[TR-D12]` for the planned 1.4.0 org-injection framing, as `it.fails` now |
| 64-65 | Quantified operational capabilities | Untagged throughput and latency targets from `scripts/loadtest.ts` (measured 2026-07-30: ADD ~2200/s flat to 20k, SEARCH p95 93 ms) |
| 66-67 | Stressors and residues | Untagged section in `architecture-style.adl` that links each stressor to the assertion that is its residue |

### Found while checking

- **Memory `.md` files are not written atomically.** `store.ts:319` and `mutate.ts:110,239` call `fs.writeFileSync` directly; only the index files go through `atomicWrite`. So `[TR-W1]` must name the index files only. A rule like "all vault writes are atomic" or "only Persistence writes vault files" would fail today. It is a design decision to take first, not an assertion to add (see Deferred).
- `session-end.sh` loads `dist/index.js`. The other hooks load only the standalone bundles (`frontmatter.mjs`, `spec-config.mjs`, `spec-fields.mjs`). `[TR-R5]` has to state that exception, or the exception gets removed.

---

## 🗂️ Unified proposal

ID letters (the coverage regex is `TR-[A-Z][0-9]+`, so one letter each): **S** structure · **R** runtime safety · **D** data governance · **Q** quality · **C** contracts *(new)* · **W** workflows/sagas *(new)* · **P** operational capabilities *(new)*.

Legend for "Test": **retag** = an existing test gets the ID in its name · **retag?** = the file covers it, pick or confirm the exact `it()` · **new** = write a small test.

### 1. `contracts.adl` (new, CATEGORY Static Coupling)

Course pages 30-31 and 44-45: strict where one release controls both ends, tolerant where it does not.

```adl
DESCRIPTION Contracts at the Total Recall boundaries: strict where one release controls both ends, tolerant where it does not
CATEGORY Static Coupling
NAMESPACE TrContractsNS
DEFINE SYSTEM Total Recall AS tr
    DEFINE ACTOR Host Harness AS host-harness
    DEFINE SERVICE MCP Stdio Server AS mcp-server
    DEFINE SERVICE Lifecycle Hooks AS hooks

# Tool calls: Zod-validated at the dispatch boundary; schemas change additively only
DEFINE CONTRACT mcp-tools BETWEEN {Host Harness, MCP Stdio Server} AS STRICT
# Hook stdin/stdout JSON: the harness adds fields over time; hooks read only what they need
DEFINE CONTRACT hook-envelope BETWEEN {Host Harness, Lifecycle Hooks} AS NAME-VALUE-PAIRS
    including {hookEventName, additionalContext, continue, transcript_path, tool_name}
# Memory files: written by the server, by the hooks, and by teammates on other plugin versions through the org vault
DEFINE CONTRACT memory-file BETWEEN {MCP Stdio Server, Lifecycle Hooks} AS NAME-VALUE-PAIRS
    including {title, tags, created, updated, author, schemaVersion}

ASSERT(The 17 core tool schemas stay identical to the golden; new tools and spec fields are additive and optional) # [TR-C1]
ASSERT(A tool call with malformed arguments is rejected at the Zod boundary as an error result, and the server keeps serving) # [TR-C2]
ASSERT(Every tool error returned to Host Harness has local filesystem paths redacted) # [TR-C3]
ASSERT(The PostToolUse matcher targets the declared server's write tools only) # [TR-C4]
ASSERT(Lifecycle Hooks inject SessionStart context only with hookEventName SessionStart) # [TR-C5]
ASSERT(A memory file with frontmatter keys this version does not know is read without error) # [TR-C6]
```

| ID | Test | Where |
|---|---|---|
| C1 | retag | `integration/schema-parity.integration.test.ts` (the "17 golden + 5 spec tools" and "optional spec fields" cases) |
| C2 | retag | `integration/boundary-enforcement.integration.test.ts` |
| C3 | retag | `registry-redaction.test.ts` |
| C4 | retag | `hooks-matcher.test.ts` ("does NOT match read-only tools") |
| C5 | retag? | `hook-scripts.test.ts` / `spec-hooks.test.ts` (both mention `hookEventName`) |
| C6 | **new** | `frontmatter.test.ts`: parse a file with an unknown key. This is the tolerant-reader point of NAME-VALUE-PAIRS, and no test pins it today. |

### 2. `workflows.adl` (new, CATEGORY Data)

Course pages 37-38 and 44-45 (sagas). Review B's `lifecycle-sagas.adl` and `durability.adl` are merged into this one file.

```adl
DESCRIPTION Asynchronous workflows of Total Recall and what survives a crash
CATEGORY Data
NAMESPACE TrWorkflowsNS
DEFINE SYSTEM Total Recall AS tr
    DEFINE SERVICE MCP Stdio Server AS mcp-server
    DEFINE SERVICE Lifecycle Hooks AS hooks
    DEFINE DATABASE Personal Vault AS personal-vault
    DEFINE DATABASE Org Vault AS org-vault
    DEFINE COMPONENT Persistence AS persistence
    DEFINE COMPONENT Org Sync AS org-sync
    # SIGTERM, SIGINT, stdin end and stdin close enter one shutdown(): flushPending, flushEmbeddings, exit
    DEFINE SAGA Session Shutdown AS shutdown-saga
        DEFINE COORDINATION Orchestrated
        DEFINE CONSISTENCY Eventual
    # Org write, then PostToolUse hook, then fail-closed privacy filter, then git commit and push; pull at SessionStart
    DEFINE SAGA Org Sync Saga AS org-sync-saga
        DEFINE COORDINATION Choreography
        DEFINE CONSISTENCY Eventual

# Crash safety
ASSERT(Persistence writes index.json, invertedIndex.json and .index-cache.txt atomically, via a temporary file and rename) # [TR-W1]
ASSERT(Session Shutdown runs exactly once across concurrent exit triggers and flushes the index before exit) # [TR-W2]
ASSERT(A memory's .md file is written before its index entry) # [TR-W3]
ASSERT(accessCount and lastAccessed survive rebuild_index) # [TR-W4]
# Org Sync Saga: compensation is block, keep, record (the privacy filter itself is TR-D3)
ASSERT(When the org push fails, the queued sync job stays for a retry) # [TR-W5]
ASSERT(Org Sync aborts, without wiping Org Vault, on a corrupt committed index or a branch switch that empties the working tree) # [TR-W6]
# Export and import
ASSERT(export_memories records an unreadable body as an error entry, and import_memories skips error entries) # [TR-W7]
```

| ID | Test | Where |
|---|---|---|
| W1 | retag | `atomic-write.test.ts` |
| W2 | retag | `index-stdin-end.test.ts` (latch case) and `integration/shutdown-sigterm.integration.test.ts` ("SIGTERM + SIGINT … pins 6.10 latch") |
| W3 | retag? or **new** | Candidates: `index.test.ts`, `vault-scan-reconcile.test.ts`. If no test pins the order, add one. |
| W4 | retag? | `vault-scan-reconcile.test.ts` |
| W5 | retag? | `sync-org-memory-hook.test.ts` |
| W6 | retag | `sync-org-memory.test.ts` (corrupt index) and `sync-org-wipe-guard.test.ts` |
| W7 | retag | `bulk.test.ts` |

Checks done: both sagas are indented under the system and their properties sit one level deeper, so `PROPERTY_KINDS` attaches them to the saga element. Every element repeats the name and kind used in `system.adl` and `data-governance.adl`. No `DEFINE COMMUNICATION` is added, so there is no endpoint-ambiguity risk.

### 3. `capabilities.adl` (new, TYPE operational)

Course pages 42-43, 52-53 and 64-65. Review B's `observability.adl` is folded in.

```adl
TYPE operational
CAPABILITY bounds-and-observability
DESCRIPTION Bounded work per tool call, and every tool call observed
NAMESPACE TrCapabilitiesNS
DEFINE CONST MAX_RERANK_KEYS = 200
DEFINE CONST MAX_FRESH_EMBEDS_PER_CALL = 50
DEFINE CONST MAX_SESSIONS_PER_MEMORY = 50
DEFINE SYSTEM Total Recall AS tr
    DEFINE COMPONENT Persistence AS persistence
    DEFINE COMPONENT Tool Registry AS registry
    DEFINE COMPONENT Tools AS tools

DEFINE CAPABILITY Boundedness AS {
    rerank candidates <= MAX_RERANK_KEYS,
    fresh embeds per rerank <= MAX_FRESH_EMBEDS_PER_CALL,
    sessions per memory <= MAX_SESSIONS_PER_MEMORY } FOR Tools
DEFINE CAPABILITY Observability AS every tool call yields a perf sample, every failure an error record FOR Tool Registry

ASSERT(rerank_memories scores at most MAX_RERANK_KEYS keys and keeps their order) # [TR-P1]
ASSERT(A memory's session history is deduplicated and capped at MAX_SESSIONS_PER_MEMORY) # [TR-P2]
ASSERT(An access-count flush saves index.json without rebuilding invertedIndex.json) # [TR-P3]
ASSERT(Every tool call through Tool Registry records a perf sample, and a failing one an error) # [TR-P4]

# Measured with scripts/loadtest.ts (TF-IDF only), not in CI: untagged on purpose
ASSERT(store_memory sustains at least 1000 writes per second, flat up to 20000 memories)
ASSERT(recall_memory p95 stays under 150 ms at 20000 memories)
```

| ID | Test | Where |
|---|---|---|
| P1 | retag? | `rerank.test.ts` |
| P2 | retag? | `mutate.test.ts` |
| P3 | retag | `persistence-readonly-flush.test.ts` |
| P4 | **new** | A registry test with mocked `recordPerfSample` and `recordError`, in the style of `registry-redaction.test.ts`. |

Check needed at implementation: the `AS { … } FOR Tools` block form. `adl-parse.ts` joins the block lines first and then matches `FOR`. If the trailing `FOR` after `}` does not resolve a target, write the capability on one line.

### 4. Extensions to existing files

**`data-governance.adl`** (course pages 33-36 and 52-53: ownership and protection). This absorbs Review B's `security-containment.adl`.

| ID | Assertion | Test |
|---|---|---|
| D6 | A memory category cannot resolve outside its vault root, and the check runs before any directory is created | retag? `index.test.ts` |
| D7 | A memory cannot carry both the org and the personal tag | retag? `privacy-routing.test.ts` / `index.test.ts` |
| D8 | For an org memory the author is the OS user; a caller-supplied author is ignored | retag? `privacy-routing.test.ts` (complements D4) |
| D9 | Frontmatter scalars and array items with an embedded newline are rejected | retag `frontmatter.test.ts` |
| D10 | A no-prune memory is never a prune candidate and needs force to be deleted | retag? `query.test.ts`, `reserved-keys.test.ts` |
| D11 | Overwriting with force archives the earlier body under `.superseded/` and records `supersededAt` | retag? `index.test.ts` |
| D12 | Org memories injected at SessionStart appear only inside a delimited "teammate-written reference data" block, and `orgInjection: "off"` injects none | **fitness-first:** `it.fails('[TR-D12] …')` now (the coverage regex accepts `it.fails`); switch to `it` in 1.4.0 when BACKLOG "Org-vault inbound injection" lands |

**`structure.adl`** (course pages 66-67: isolate the part that varies)

| ID | Assertion | Test |
|---|---|---|
| S10 | Search (tfidf, ebbinghaus, rrf) has no dependency on Vectors or Persistence | **new** ArchUnit rule plus a `SEARCH` set in `components.ts` |
| S11 | The bulk and architecture tools depend on no tool other than store, mutate and Tool Registry | **new** ArchUnit rule. Keep it separate from S5, because adding them to `TOOL_NAMES` would fail S5. |

**`runtime-safety.adl`**

| ID | Assertion | Test |
|---|---|---|
| R5 | Lifecycle Hooks load server code only through the standalone `dist/*.mjs` bundles; `session-end.sh` is the one hook that runs `dist/index.js` | **new** test: grep `hooks/scripts/*` |

**`code-quality.adl`** (course pages 30-31 and 47-48: agents may not make the build green by weakening it)

| ID | Assertion | Test |
|---|---|---|
| Q2 | Every unit test that imports a mutated module is in the Stryker allow-list, or excluded with a reason | retag `stryker-allowlist.test.ts` |
| Q3 | `.claude-plugin/plugin.json` and `gemini-extension.json` declare the `package.json` version | **new** (today only CI's `git diff` after `sync:version` checks this) |
| Q4 | Every `it()` in `src/__tests__` contains at least one `expect` | **new**. Run it first and list the offenders; the fix may need an allow-list. |
| Q5 | No test asserts a tautology (`expect(true).toBe(true)`, `expect(x).toBe(x)` on literals) | **new** |
| Q6 | The Stryker break threshold is at least 65 | **new** (reads `stryker.conf.json`) |
| Q7 | The mutation workflow runs `npm audit --audit-level=critical` before the build | **new** (reads `.github/workflows/mutation.yml`) |
| Q8 | The release workflow publishes only after a successful mutation run | **new** (reads `release.yml`: `workflow_run` plus the `conclusion == 'success'` condition) |

### 5. `architecture-style.adl` (new, untagged, descriptive)

Course pages 62-63 (style and capabilities) and 66-67 (stressors and residues). This is Review B's idea, extended. It has **no tagged assertions**, so it adds no test debt; `index_architecture` still indexes it.

```adl
DESCRIPTION Architecture style, the capabilities it favours, and the stressors it is built to survive
CATEGORY Architectural Capabilities
NAMESPACE TrStyleNS
DEFINE SYSTEM Total Recall AS tr
DEFINE STYLE Total Recall AS Modular Monolith, local-first, one deployable per machine
DEFINE CAPABILITY Simplicity AS one Node process, Markdown files, no server to run
DEFINE CAPABILITY Cost AS zero runtime cost; optional embeddings run locally
DEFINE CAPABILITY Evolvability AS tools isolated behind one registry (TR-S5, TR-S11)

# Stressors and their residues
# S1 the host harness changes its hook API (Claude Code, Gemini CLI): residue TR-C5, hooks.gemini.json
# S2 the embedder or a native binding is missing: residue TR-R1, TR-R3
# S3 a teammate runs an older plugin version: residue TR-C1, TR-C6
# S4 the vault grows to tens of thousands of memories: residue the loadtest targets in capabilities.adl
# S5 a teammate pushes hostile org content: residue TR-D3, TR-D12
ASSERT(Each stressor above has at least one tagged assertion as its residue)
```

Check at implementation: `DEFINE STYLE Total Recall AS …` reuses the system's display name. That is fine, because STYLE is a value kind and creates no element. If the indexer resolves it as a target anyway, rename it to `Total Recall Style`.

---

## 🚫 Rejected or deferred

| Item | Source | Why |
|---|---|---|
| Bilingual query-expansion dedup; executive summary stops at the next heading and caps at 500 chars | A (P4, P5) | Unit behaviour, not architecture. Stays a unit test. |
| Frontmatter keys escaped before RegExp interpolation | B | Same reason. D9 already covers the injection risk at the architectural level. |
| `memory-archive` contract between the server and Tools | A | Not a boundary. Replaced by `memory-file` (C6). |
| `DEFINE COMMUNICATION` lines inside the sagas | B | Adds endpoint-ambiguity risk for little gain; `system.adl` already holds the landscape. |
| Six files and five new letters | B | Merged into three files and three letters; durability and security go into existing files. |
| Team-structure ADL (pages 71-74) | course | One maintainer plus agents. Revisit if contributors join; the first rule would be "agent commits carry a Co-Authored-By trailer". |
| **Deferred:** "Only Persistence writes vault files" / "all vault writes are atomic" | own | False today (`store.ts`, `mutate.ts`, `journal.ts` write directly). Decide first whether `.md` writes should go through `atomicWrite`; if yes, it becomes an ADR and then an assertion. |

---

## 🛠️ Execution plan

Work in `plugins/total-recall/`, on a branch. Each PR keeps `npm test` green.

### PR 1: retag only (no production code)

1. Add `contracts.adl` (C1-C5), `workflows.adl` (W1, W2, W4-W7), `capabilities.adl` (P1-P3), and D6-D11 and Q2.
2. For every "retag?" row, open the file, pick the `it()` that really asserts the rule, and prefix its name with the ID. If none does, move the row to PR 2 as **new**.
3. `npx vitest run src/__tests__/architecture`: the coverage and consistency gates, including "parses every line".
4. `ARCHITECTURE.md`: extend the ID convention line (`C` contracts, `W` workflows, `P` operational capabilities), add rows to the "Architecture as code" table, and add the `[TR-xx]` IDs to the matching Key Invariants rows.

### PR 2: new fitness rules

C6, W3 (if needed), P4, S10, S11, R5, Q3-Q8, plus the C5 or W5 rows if PR 1 found no exact test. For Q4, run the check first and record the offenders before deciding between fixing them and an allow-list.

### PR 3: descriptive layer

`architecture-style.adl` and the two untagged loadtest targets in `capabilities.adl`.

### PR 4 (with 1.4.0): fitness-first flip

Add `it.fails('[TR-D12] …')` in PR 2 or 3. When the org-injection framing and `orgInjection` config land, it starts failing; switch it to `it` in the same PR as the feature.

### Every PR

- `npm run typecheck && npm test`
- Dogfood: `index_architecture(path=plugins/total-recall)`, then `validate_architecture`. The new files are picked up by the `architecture/adl/*.adl` glob.
- Capture decisions in Total Recall (`store_memory`, category `decisions`, `artifact="adr"`): the C/W/P letters, the "rules, not unit behaviours" cut, and the deferred atomic `.md` write decision.
- No version bump needed for PRs 1-3: they are tests and docs only, and `release.yml` cuts a tag only when `package.json`'s version changes.

## 📊 Count

| | Today | After |
|---|---|---|
| ADL files | 5 | 9 |
| Tagged assertions | 19 | 53 (+21 retag, +12 new, +1 fitness-first) |
| Untagged assertions | 0 | 3 |
| Course constructs used | SYSTEM, COMPONENT, SERVICE, DATABASE, ACTOR, EXTERNAL, CONST, COMMUNICATION, FOREACH | + CONTRACT … BETWEEN … including, SAGA + COORDINATION/CONSISTENCY, TYPE/CAPABILITY, DEFINE CAPABILITY … FOR, STYLE |
