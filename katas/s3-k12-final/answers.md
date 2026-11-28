# K12 — Final: dispositions and the promotion plan

**Status: PROPOSAL for the maintainer. Nothing here changes the production ADL, a test, a workflow or an ID.** The plan (§1, §5) says promotion is decided in `architecture/REVIEW.md` on the evidence of K1–K11; this file is that evidence, in one table, plus a staged way to act on it. Every "promote" below is a recommendation, and every ID is a reservation, not an allocation.

**Evidence.** K1–K11 are PRs #73, #75–#84 (K1 is #73, K2 #75, K3 #76, K4 #77, K5 #78, K6 #79, K7 #80, K8 #81, K9 #82, K10 #83, K11 #84). Each carries its sketch, kata tests, `answers.md` and a stored decision memory. The sketches live in those PRs, so the table below cites them by ID, not by link.

## 1. The 26 sketch assertions

Dispositions use the plan's three outcomes: **(a)** promote into `architecture/adl/` with a `TR-*` ID and a test; **(b)** keep as an interactive (human/LLM) check recorded in `REVIEW.md`; **(c)** reject with a reason. "Revise ADL" means a production ADL gap the sketch found, fixed by editing the production file.

| Sketch | What it checks | Real-tree result | Recommendation | Reserved ID |
|---|---|---|---|---|
| K1-01 | every component has a file-set and every file-set owns a file | pass | **(a)** promote | TR-S16 |
| K1-02 | each allow-list rule is exercised | pass | **(c)** reject: a ceiling is not a floor, and it overfits to today's imports | — |
| K2-01 | complexity measurer reproduces the course's 15 | pass | **(a)** promote | TR-Q12 |
| K2-02 | no new function reaches the agent limit (5) | 71-function ceiling | **(b)**/revise: needs a per-function frozen list first | — |
| K2-03 | A/I/D per component | 7 of 12 in the "pain zone" | **(c)** reject as a gate: it flags the intended foundation | — |
| K3-01 | every cross-version boundary is a declared contract | **gap: org `index.json`** | **Revise ADL** (add `org-index` contract), then **(a)** | TR-C10 |
| K3-02 | bootstrap, marketplace and plugin names agree and are append-only | pass | **(a)** promote | TR-C11 |
| K4-01 | every contributor-only file is on the release strip list | **was red; fixed in #77** | **(a)** promote | TR-Q13 |
| K4-02 | all four version copies agree and the sync script names each | pass | **(a)** promote (extends `TR-Q3`) | TR-Q14 |
| K5-01 | each artifact is written only by its declared writers | pass | **(a)** promote | TR-D14 |
| K5-02 | every `git push` site knows the privacy filter | pass | **(a)** promote (sharpens `TR-D3`) | TR-D15 |
| K6-01 | every saga failure site has a declared compensation | pass | **(a)** promote | TR-W11 |
| K6-02 | every failure mode is exercised by a test | **7 untested** | hold until the pinned list is empty (backlog entry) | — |
| K7-01 | every dynamic cross-quantum coupling is declared | **gap: hooks → server** | **Revise ADL** (`system.adl` edge), then **(a)** | TR-R9 |
| K7-02 | every edge to an external is async | pass | **(a)** promote | TR-R10 |
| K8-01 | every file in the stressor matrix exists | pass | **(a)** promote | TR-E2 |
| K8-02 | every source of variability is a stressor | **3 missing** | **Revise ADL** (add S8–S10 with residues), then **(a)** | TR-E3 |
| K9-01 | ADL performance numbers equal the enforced budget | pass | **(a)** promote | see §3 |
| K9-02 | the ADL does not understate what CI enforces | **stale comment** | fold into the comment fix; no assertion | — |
| K9-03 | "not yet measured" has a backlog entry with a trigger | pass | **(c)** reject: cheap but rarely changes | — |
| K10-01 | raw memory writes are a recorded exemption | pass (4 sites) | **(b)**: folds into the atomic-writes ADR | — |
| K10-02 | no memory writer leaves provenance empty | **extractor flagged** | hold until the backlog fix lands | — |
| K10-03 | a failed supersede archive is recorded | **swallowed** | hold until the backlog fix lands | — |
| K11-01 | instructions point at things that exist | pass | **(a)** promote | TR-Q15 |
| K11-02 | every ADL file has an owner row | pass | **(a)** promote | TR-Q16 |
| K11-03 | ADL commits carry evidence | 1 early exception | **(c)** reject, or keep as a sketch: needs full git history | — |

Counts: **16 to promote** (after the three ADL revisions), **3 held** behind a backlog fix, **2 interactive or folded**, **5 rejected or dropped**.

## 2. Findings that need a decision regardless of promotion

| Finding | Where | State |
|---|---|---|
| Release strip list missed `vitest.katas.config.ts` | K4 | **fixed** in #77 (`release.yml`) |
| Org `index.json` has a version guard but no declared contract | K3 | open: revise `contracts.adl` |
| Hooks → server marker file and SIGTERM undeclared in `system.adl` | K7 | open: revise `system.adl` |
| Stressors S8–S10 missing (Node version, config read once, nested `claude -p`) | K8 | open: revise `architecture-style.adl` |
| `capabilities.adl` comment says the benchmark is "not in CI" | K9 | open: fix the comment |
| 7 org-sync failure modes with no test | K6 | `DEFERRED` entry, expiry 2027-06-30 |
| Silent supersede-archive failure | K10 | `DEFERRED` entry, expiry 2027-06-30 |
| PreCompact extracts carry no provenance | K10 | `DEFERRED` entry, expiry 2027-06-30 |
| Raw `.md` writes in the server | K10 | existing `DEFERRED` entry |

## 3. How to act on it (staged, so each PR stays reviewable)

Promotion follows plan §5: allocate the next free ID in the series, move the `ASSERT` into the production ADL in the house style, rename the test tag from `[Kn-nn]` to `[TR-xx]` and move the test next to its suite, add the `# S<n> …: residue TR-xx` line where the assertion is a stressor's residue, delete the sketch and the kata test. Promoted tests enter the default suite, so they are subject to `test:coverage` (95/95/90/95), the Stryker allow-list rule (`[TR-Q2]`) and Stryker's break threshold.

1. **ADL revisions first** (no new IDs): `contracts.adl` (`org-index`), `system.adl` (hooks → server), `architecture-style.adl` (S8–S10), the `capabilities.adl` comment. These are the real findings and are small.
2. **Process and repo-hygiene assertions** (K1-01, K2-01, K4-01, K4-02, K11-01, K11-02): pure source checks, low risk to the mutation gate.
3. **Contract, data and runtime assertions** (K3-01, K3-02, K5-01, K5-02, K6-01, K7-01, K7-02, K8-01, K8-02, K9-01): each reads real files, so each needs its own look at flakiness under Stryker.

Open points the maintainer should settle, because they are judgement, not evidence:

- **`TR-P6` and `TR-P7` are named "pending" in `GOVERNANCE.md` §2** for the benchmark. `K9-01` should take them or move past them, not collide.
- **The tests that read the git history or real files** (K11-03 and the real-tree parts of K4-01, K7-01, K9-02) are fragile in a shallow clone or when a file is renamed; decide whether the extra guard is worth that.
- **Whether `katas/` stays after promotion.** Plan §5 deletes the sketches and kata tests; `answers.md` files are the record and could stay.
- **The course checklist** (`ARCHITECTURE_AS_CODE_CHECKLIST.md`, sections 1–12 and the §12 minimum release gate) lives outside this repo and was not renewed here; it is a review the maintainer does against these results.

## 4. What this file does not do

- It does not allocate IDs, edit any `.adl` file, move a test, or change a workflow.
- It does not decide: every row is a recommendation.
- It does not assert that the 11 open PRs are merged. Until they are, the sketches live only in their branches.

## 5. Dogfood

- A decision memory for this proposal is stored via `store_memory` (`category: architecture-changes`, `elements` naming the promotion candidates). `validate_architecture` has nothing to check here: this PR adds no sketch and no test.
