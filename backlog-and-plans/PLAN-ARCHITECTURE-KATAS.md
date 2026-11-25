# Plan — Architecture Katas on the `total-recall` repo

**Date:** 2026-11-25 · **Status:** ACTIVE · **Owner:** Adrian Balaban
**Source repo:** `/home/adrianb/_/in-progress/total-recall` — branch `main` @ `2ea8d53` (the plan was verified against the code at this commit)
**Replaces:** `PLAN-ARCHITECTURE-KATAS-TOTAL-RECALL.md` from `cursuri/masterclassNealFord2026/` (deleted at the pivot; the orphan drafts `sysops-squad/` and `monitor-me/` stay as raw material, untouched).
**Reason for the pivot:** the course katas (Make the Grade, Sysops Squad, Monitor Me) become exercises on the real `total-recall` repo, not in separate repos. The repo already has a mature AaC system: 9 production ADL files in `plugins/total-recall/architecture/adl/`, the `adl-coverage.test.ts` gate (plus `adl-consistency.test.ts`, `adl-repo-rules.test.ts`, `stressor-residues.test.ts`), ArchUnitTS fitness functions (`fitness.test.ts`), the mutation gate, `capabilities.adl` + the budgeted benchmark (`scripts/loadtest.ts` + `scripts/loadtest-budget.json`), `GOVERNANCE.md`/`REVIEW.md`. The katas are no longer built separately — they run on total-recall itself, with synthetic fixtures in temporary directories and through the existing gates.

> **Path convention:** paths in the tables without a prefix (`src/…`, `hooks/…`, `architecture/…`, `scripts/…`) are relative to `plugins/total-recall/`. Prefixed paths (`katas/…`, `backlog-and-plans/…`, `.github/…`) are relative to the repo root.

## 0. Executive summary

`total-recall` becomes the "playground" for architecture katas:

- **3 series (4+4+3) + a final K12 — 12 katas in total (K1–K12)**, applied directly to the real repo: S1 = K1–K4, S2 = K5–K8, S3 = K9–K11, K12 = the decision finale.
- The `TR-*` assertions in the 9 ADL files (e.g. `TR-S1`, `TR-D5`, `TR-Q3`, `TR-P2`) are already in `architecture/adl/` and are validated by `adl-coverage.test.ts` — the katas do not invent a parallel system, they exercise the existing one.
- Each round = one session (~1–1.5 h) = branch `feat/katas-kX` + a PR through the existing gate `.github/workflows/mutation.yml`: npm audit → typecheck → build (+ version-sync check) → `test:coverage` (thresholds 95/95/90/95) → `test:integration` → Stryker ≥ 65 → `npx` launcher tests (`npm test` at the root + `test/pack-guard.mjs`); in parallel, the `benchmark-smoke` job (`LT_N=250`, budget enforced). The kata tests are **not** part of this gate: they run in the separate workflow `.github/workflows/katas.yml` (§3.6), which does not block the release (`release.yml` starts only after `mutation`).
- **Load-bearing, not wallpaper:** every new fitness function protects data integrity, privacy (`privacy-filter`), write atomicity, crash safety — nothing cosmetic.
- **Fail = feedback, not a bug:** every failing assertion gets an explicit disposition (fix implementation / revise ADL / exemption with expiry — the format in `architecture/GOVERNANCE.md` §3).
- **ADL sandbox until K12:** the sketches live in `katas/**/adl/*.adl` at the repo root — outside the scan of the ADL gates (they all read only `plugins/total-recall/architecture/adl/`) and not shipped (the root npm package publishes only `bin`; the plugin is distributed from `plugins/total-recall/` through the `release` branch). Promotion is decided only at K12, on the criteria in `architecture/REVIEW.md` + checklist §1–12.
- **Sketch IDs, not `TR-*`:** sandbox assertions carry `[K<n>-<nn>]` IDs (e.g. `# [K5-01]`). `validate_architecture` and `trace` recognise them (they accept any tag `[A-Za-z][A-Za-z0-9_.-]*`), but `adl-coverage` ignores them (its regex is `TR-[A-Z][0-9]+`) — so CI does not go red, and no `TR-*` IDs are allocated prematurely (see §3.6).
- **Two manifestations:** every fitness function generated from ADL is verified on one case that passes and one that fails, before it is believed (see §3.3 — "fails" means the test demonstrates detection, not that CI is red).
- **Dogfood integration:** every kata runs the plugin itself on its own materials (`index_architecture`, `validate_architecture record:false`, `trace(id=...)`, `store_memory` with `elements: ["assert:K*-*"]`). Findings that are not promoted now go into `backlog-and-plans/BACKLOG.md` with a trigger, as in the compliance pass.

## 1. Program structure

The deliverable of each kata, in the format of the course folders (`make-the-grade-pages-28-29` … `73-74` — `answers.md` + `adl/*.adl`):

```
katas/                         (repo root)
  s1-k1-structure/       ├─ answers.md   (scenario, answers, dispositions)
  s1-k2-code-quality/    └─ adl/*.adl   (ADL sketch — sandbox, outside the gate, IDs [K<n>-<nn>])
  ...
  s3-k11-team/         (same for K1–K11; K12 has no adl/ — only the wrap-up and decisions)

plugins/total-recall/src/__tests__/katas/
  k1-*.test.ts …         (kata fitness functions — separate workflow `katas.yml`, see §3.6)
```

| Series | Kata | What is exercised on total-recall | ADL reference / real file | Course pages (`AaC-2day_ex`) |
|---|---|---|---|---|
| **S1 — structure, code, contracts** | **K1** | Entity Trap vs the real structure: the singletons in `state.ts`, junk drawers, versus the partition and the forbidden dependencies | `structure.adl` (`TR-S1..S15`), `src/state.ts`, `src/__tests__/architecture/components.ts` | 21–24 |
| | **K2** | Quality of agent-generated code: cyclomatic complexity + A/I/D, agent vs human thresholds | `code-quality.adl`, `src/__tests__/architecture/complexity.ts` + `complexity-baseline.json` | 28–29 |
| | **K3** | 3 install channels (`npx` bootstrap / marketplace from the `release` branch / `--local`) + STRICT/PERMISSIVE contracts (tool schema, hook envelope `hooks.json` vs `hooks.gemini.json`, frontmatter, index.json) | `contracts.adl`, `src/__tests__/hooks-parity.test.ts` | 30–31 (channels with different release cadences) + the ADL guide (`AS STRICT`) |
| | **K4** | Repo topology & shared code: `install.sh` (root vs plugin), the Gemini copy (`agy plugin install`, `--gemini`), the `release` branch (`.github/workflows/release.yml`) — the share-vs-duplicate table | `src/__tests__/architecture/adl-repo-rules.test.ts`, `src/__tests__/plugin-manifest.test.ts`, `TR-Q3` | 26–27 |
| **S2 — the vault as a database** | **K5** | The write matrix (index.json / sqlite / org vault / `.md` files) + privacy — "only written by" in ADL (existing model: `TR-W8`, a single writer for `.index-cache.txt`; `TR-D1/D2` for the vaults) | `data-governance.adl`, `src/privacy-filter.ts` | 33–38 |
| | **K6** | Org-sync as a saga: failure modes. The "no memory lost or duplicated after a queue drain" reconciliation **already exists** (`TR-W9`, `TR-W10`) — the kata audits it against the course saga and looks for uncovered failure modes (`TR-W5`, `TR-W6`) | `workflows.adl`, `src/org-sync.ts` | 44–45 |
| | **K7** | Quanta & coupling: MCP server vs hook processes vs CLI — marker files, the fixed 10 s poll (`DEFAULT_POLL_MS`), the `# edge: sync/async` convention (enforced by `adl-consistency.test.ts` on `system.adl`) | `system.adl`, `src/auto-reconcile.ts` | 40–43 |
| | **K8** | Stressor × component: the matrix **already exists** (`S1..S7` in `architecture-style.adl`, format enforced by `TR-E1` / `stressor-residues.test.ts`). The kata confronts it with the missing stressors (Node version, config without restart) and checks the residues for a Claude CLI change (S1), sqlite ABI (S2), 20k scale (S4) | `architecture-style.adl`, `capabilities.adl`, `runtime-safety.adl` | 66–67 (from the S3 block — see §2) |
| **S3 — capabilities, agents, teams** | **K9** | Fitness functions before architecture: recall quality is declared unmeasured in the README ("Retrieval quality is not yet measured"); eval harness = DEFERRED in BACKLOG | `capabilities.adl`, `scripts/eval/spec-eval.ts`, `scripts/loadtest.ts` | 52–53, 64–65 |
| | **K10** | "No memory may be lost": supersede chain (`TR-D11`), `.md` → index ordering (`TR-W3`), PreCompact extraction without provenance, non-atomically written `.md` files (`fs.writeFileSync` in `src/tools/store.ts`, `src/tools/mutate.ts` — only the indexes go through `atomicWrite`), index without a lock (documented decision in `src/persistence.ts`, `mergeRuntimeFieldsFromDisk`) | `workflows.adl`, `hooks/scripts/extract-and-store-memories.sh` | 35–36 (no-lost-answer reconciliation) |
| | **K11** | Human + agent team: team ADL, commit history as governance; checks that cannot be deterministic stay interactive evaluations (human/LLM), not proof (checklist §9) | `architecture/GOVERNANCE.md`, `plugins/total-recall/CLAUDE.md` (the repo root has no `CLAUDE.md`) | 47–50, 69–74 |
| | **K12 FINAL** | Wrap-up: each sketch ASSERT → (a) promoted into `architecture/adl/` + a test with a `TR-*` ID (procedure in §5), (b) an interactive (human/LLM) check recorded in `architecture/REVIEW.md`, (c) rejected with a reason; checklist §1–12 renewed; §12 minimum release gate = acceptance | all the ADLs + `REVIEW.md` | 54–55, 62–63 + the whole checklist |

## 2. Sources and map

All in `/home/adrianb/_/in-progress/cursuri/masterclassNealFord2026/`. The pages per kata are in the column in §1; the ranges below are indicative — K8 (S2) uses pp. 66–67, from the S3 block, and K10 (S3) uses pp. 35–36, from the S2 block.

| Material | Used for |
|---|---|
| `AaC-2day_ex.pdf/txt`, pp. 21–31 (structure vs implementation, repo topology, code quality, in-flight change) | S1 (K1–K4) |
| `AaC-2day_ex.pdf/txt`, pp. 33–45 (data topology, data governance, quanta, coupling, saga) | S2 (K5–K7), K10 |
| `AaC-2day_ex.pdf/txt`, pp. 47–74 (governance, fitness-driven, capabilities, constant change, teams) | S3 (K9–K11), K8, K12 |
| `AaC-2day_ex.pdf/txt`, pp. 75–123 (the ADL guide: directives, assertion catalogue, pitfalls) | the notation in all rounds |
| `SECTIONS.md` — the index pages → folder → what is produced | choosing the model folder per kata |
| `HTTAA-2day_ex_solutions.pdf/txt` — the official solutions | comparison after each kata |
| `CC-AA-REF.pdf/txt` — the ADL reference, written on Sysops Squad examples | S2 |
| `ARCHITECTURE_AS_CODE_CHECKLIST.md` — 12 sections + §12 minimum release gate + review template | K12 and the acceptance of each kata |
| `TeamTopologies.pdf/txt` | K11 |
| `CALM.md` (FINOS CALM) | K12 — the non-adoption revisited, or not |
| `make-the-grade-pages-*` — 21 folders. Format model = the 18 from pp. 28–74 (`answers.md` + `adl/`; 69–70 has only `answers.md`). Those from pp. 21–27 use an illustrative YAML notation (21–22 has no `answers.md` either) — content only, not format | the deliverables' format |
| `workshop2024/` — the origin of the katas format | background, read-only |

## 3. Program rules (repo hygiene)

1. **No real data.** Every new check is written exclusively on synthetic fixtures under `os.tmpdir()` (the convention in `src/__tests__/assert-tmp-path.ts`: any destructive operation outside the temp dir throws); nothing from the real vault enters the diff.
2. **Zero new dependencies.** Every promoted test uses only existing dependencies (vitest, ArchUnitTS, fast-check, tsx). The runtime footprint stays untouched: 2 hard dependencies (`@modelcontextprotocol/sdk`, `zod`) + 3 optional (`@huggingface/transformers`, `better-sqlite3`, `sqlite-vec`).
3. **Two manifestations.** Every fitness function generated from ADL is verified on one case that passes and one that fails, before it is believed. Concretely (`GOVERNANCE.md`: "a known-passing and a known-failing fixture"): two green tests — one on the good fixture (the check reports nothing), one on the bad fixture (the check reports exactly the expected violation). CI is not made red on purpose; `[TR-Q4]` (at least one assertion) and `[TR-Q5]` (no tautologies) apply to kata tests too.
4. **Load-bearing walls, not wallpaper.** Data integrity, privacy, write atomicity and crash safety are protected — nothing cosmetic.
5. **Fail = feedback, not a bug.** Every failing assertion gets an explicit disposition: fix implementation / revise ADL / temporary exemption — a `DEFERRED` entry in `backlog-and-plans/BACKLOG.md` **with an expiry date** (`GOVERNANCE.md` §3; an expired exemption is a Fail at the next REVIEW pass).
6. **ADL sandbox until K12.**
   - The sketches live in `katas/**/adl/*.adl`; they do not enter `plugins/total-recall/architecture/adl/` (the gate would go red there immediately), `dist/` or the npm packages.
   - Sketch IDs have the form `[K<n>-<nn>]`, never `[TR-…]`. A kata test may cite an **existing** `[TR-xx]`, but not a new one: `adl-coverage` fails on any `[TR-xx]` in a test name that has no production ASSERT.
   - Kata tests live in `plugins/total-recall/src/__tests__/katas/` (vitest is rooted in `plugins/total-recall/`, so a test placed in `katas/` at the repo root would not run anywhere and could not resolve `archunit` from `node_modules`). They are excluded from the default suite (`vitest.config.ts`, so also from `test:coverage` in the `mutation` gate) and from Stryker (which runs only the allow-list anyway), and run through `vitest.katas.config.ts` / `npm run test:katas` / `.github/workflows/katas.yml` (triggered by changes in `katas/**`, `src/**`, `architecture/**`; `passWithNoTests` until the first kata lands). The hygiene rules `[TR-Q4]`/`[TR-Q5]` and `adl-coverage` still walk the directory, so they apply to the kata tests too.
7. **ADL notation** is the one in the guide pp. 75–123: `DEFINE SYSTEM X AS id`, `ASSERT(...)`, indentation = containment. Prefer `IS DEPENDENT ON` + an explicit `HAS NO DEPENDENCY ON` over the exclusive form `IS ONLY DEPENDENT ON` (the guide, "Prefer …"). `IS DEPENDENT ON` is an existence claim: the generated check is "at least one class", not a per-class rule. Note: the production ADL writes assertions in natural language, with the ID as a trailing comment (`ASSERT(Tool Registry depends only on State and Paths) # [TR-S6]`). Sketches may use the form from the guide, but at promotion (K12) they are rewritten in the house style.
8. **External materials stay read-only.** The folders `make-the-grade-pages-*`, `workshop2024/` and the orphan drafts (`sysops-squad/`, `monitor-me/`) in the masterclass are not modified — read only.

## 4. Mechanics of a kata round (per session)

1. Read the scenario and tasks from the course material (the matching row in §1 + the sources in §2; the model folder from `SECTIONS.md`).
2. Write or update the sketch `katas/sX-kY-*/adl/*.adl` — assertions with sketch IDs `# [KY-nn]`, no `TR-*`.
3. Write the fitness function in `plugins/total-recall/src/__tests__/katas/kY-*.test.ts` (ArchUnitTS on the real code, or a check on a synthetic fixture under `os.tmpdir()`), with test names carrying the sketch ID (`it('[KY-nn] …')`), verified known-pass + known-fail (§3.3).
4. The dogfood loop:
   - `index_architecture` on the kata folder, so the index contains only the sketch.
   - `validate_architecture` with `record:false` on the **repo root** — only there does it see both `katas/**/adl` and the tests in `plugins/total-recall/src/__tests__/katas/` (on the kata folder, every ID would show up without a test). `record:false` is mandatory: otherwise every sketch failure becomes a `troubleshooting/fitness-*` memory in the personal vault.
   - `trace(id=...)`, then `get_architecture_context(...)` before any code generation.
   - Kata decisions are saved through `store_memory` with `elements: ["assert:KY-nn"]`.
   - Note: the `architecture-change` hook fires on any `.adl` edit (including in `katas/`) and suggests `index_architecture` on the cwd — this is expected, not an error.
5. `answers.md` for the round: question → answer → evidence (link to the ADL/test).
6. Every unresolved item gets one of the 3 dispositions — no gap without a disposition.
7. PR `feat/katas-kX` → gates → merge; product findings that are not promoted go into `BACKLOG.md` with a trigger.

## 5. Cadence & validation

- **One kata = one session** (~1–1.5 h) = branch `feat/katas-kX` in total-recall.
- Validation commands (the same as in `mutation.yml`):

```bash
npm --prefix plugins/total-recall run typecheck
npm --prefix plugins/total-recall run test:coverage     # unit + adl-* + fitness, with the CI coverage thresholds (without katas)
npm --prefix plugins/total-recall run test:katas        # kata fitness functions (workflow `katas.yml`)
npm --prefix plugins/total-recall run test:integration  # builds and runs against the real bundle
npm --prefix plugins/total-recall run mutation          # Stryker ≥ 65 (break), when promoting new tests
npm test && node test/pack-guard.mjs                    # at the root: the npx launcher + the package guard
```

- **Exit checklist per round:** clean `git status` — empty working tree, zero debugging artifacts (including `.stryker-tmp/`). Every disposition leaves a trace: fix implementation → commit in the PR; revise ADL → the sketch diff; exemption → a `DEFERRED` entry with expiry in `BACKLOG.md`.
- **Promotion (only at K12):** the decision is taken in `architecture/REVIEW.md`, based on the evidence accumulated over all rounds. For each promoted assertion:
  1. Allocate the next free ID from the matching series. At `2ea8d53` these are `TR-S16`, `TR-D14`, `TR-W11`, `TR-R9`, `TR-P6`, `TR-Q12`, `TR-C10`, `TR-E2`.
  2. Move the ASSERT into the production ADL file, in the house style (§3.7).
  3. Rename the test tag from `[KY-nn]` to `[TR-xx]` and move the test from `__tests__/katas/` next to its suite (from there it enters the default suite and the `mutation` gate).
  4. If the assertion is the residue of a new stressor, add the line `# S<n> …: residue TR-xx` in `architecture-style.adl` (the `TR-E1` format).
  5. Delete the remaining sketch and kata test.

## 6. Non-goals (explicit)

- No separate repos/katas in `cursuri/masterclassNealFord2026/` — all rounds run on total-recall.
- No importing requirements from the katas into the product (200k students, brokers, medical devices — method sources only; lesson §1.3 of `PLAN-ARCHITECTURE-AS-CODE-COMPLIANCE.md`).
- No microservices/broker/mesh — the local-first monolith stays non-negotiable.
- No mandatory CALM — it stays only an optional stretch at K12 (support was removed in 1.3.0, recorded in `docs/SPEC-DRIVEN.md`); if retried, the dependency sits in tooling/CI, not at runtime.

---

_The plan is designed to be runnable in kata sessions (~1–1.5 h/round), on the existing gates; every new fitness function must have known-pass + known-fail + an explicit disposition._
