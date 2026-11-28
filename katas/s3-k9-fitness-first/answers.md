# K9 — Fitness functions before architecture claims (course pp. 52–53, 64–65)

Sketch: [adl/fitness-first-kata.adl](adl/fitness-first-kata.adl) · Fitness functions: [k9-fitness-first.test.ts](../../plugins/total-recall/src/__tests__/katas/k9-fitness-first.test.ts) · Sketch IDs `[K9-01]`..`[K9-03]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** A capability or an architecture claim is only as good as the fitness function that measures it. Define the fitness function first, then the capability; decide what the checks run against; and say plainly what is not measured. (Course model: `masterclassNealFord2026/make-the-grade-pages-52-53` and `-64-65`, outside this repo.)

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Which capabilities are claimed, and which are measured? | Bounds and observability (`TR-P1`..`TR-P5`) are tagged and tested. Performance (1000 writes/s, recall p95 under 150 ms, 20000 memories) is measured by `scripts/loadtest.ts` against `loadtest-budget.json`: smoke in the PR gate, full weekly. Retrieval quality is **not** measured, and the README says so. | `capabilities.adl`, `mutation.yml`, `README.md` |
| Is the fitness function defined before the capability? | For performance, yes: the budget carries the ADL numbers. For recall quality, no: the harness is a `DEFERRED` backlog entry whose trigger is a scoring change. The spec-driven side has one (`scripts/eval/spec-eval.ts`, run in CI on a generated corpus). | `BACKLOG.md`, `spec-eval.test.ts` |
| Do the claim and the check agree? | The numbers agree (`[K9-01]`). The wording does not: the ADL comment says the benchmark is "not in CI". | `[K9-01]`, `[K9-02]` |
| Is an unmeasured claim declared, not hidden? | Yes: the README sentence is paired with a backlog entry that has a trigger. | `[K9-03]` |

## What the sketch adds

- **`[K9-01]`** compares the three numbers in the ADL prose with the `full` profile of the budget file. The loadtest scale is per vault and fills two vaults, so 10000 × 2 = 20000.
- **`[K9-02]`** compares a claim about CI with the workflows. The real tree has a stale comment: `capabilities.adl` says the targets are "measured with scripts/loadtest.ts, not in CI: untagged on purpose", while `mutation.yml` runs the smoke profile on every PR and the full profile weekly, against the budget. Pinned as a finding.
- **`[K9-03]`** checks the pairing between "not yet measured" in the README and a backlog entry with a trigger.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail |
|---|---|---|
| `[K9-01]` | matching numbers → `[]`; the real ADL and budget agree | a loosened budget is named per number (rate, p95, memories) |
| `[K9-02]` | an accurate "not in CI", or no claim with the benchmark in CI | a "not in CI" claim while a workflow enforces the budget; the real tree is pinned as this case |
| `[K9-03]` | claim with a matching entry and trigger; the real README and backlog | a claim with no entry, or an entry with no trigger |

10 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s3-k9-fitness-first`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K9-01","assert:K9-02","assert:K9-03"]`).

## Dispositions

| Item | Disposition |
|---|---|
| Stale "not in CI" comment in `capabilities.adl` | **Revise ADL** at K12: say smoke runs in the PR gate and full runs weekly; consider tagging the two performance asserts (`TR-P6`) once the weekly job is treated as a gate. |
| `[K9-01]` | Promotion candidate at K12 (next free ID `TR-P6`). |
| `[K9-02]` | Folds into the comment fix above; no separate assertion needed after it. |
| `[K9-03]` | Promotion candidate at K12 as a documentation rule, or reject: the pairing is cheap but rarely changes. |
| Recall quality unmeasured | Existing `DEFERRED` entry, trigger a scoring change. Not reopened; the kata does not build an eval harness. |
