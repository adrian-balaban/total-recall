# K2 — Quality of agent-generated code (course pp. 28–29)

Sketch: [adl/code-quality-kata.adl](adl/code-quality-kata.adl) · Fitness functions: [k2-code-quality.test.ts](../../plugins/total-recall/src/__tests__/katas/k2-code-quality.test.ts) · Sketch IDs `[K2-01]`..`[K2-03]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** An agent generates Auto Grading; functional tests pass. CI reports Na/Nc/Ca/Ce per component. Is the code any good, and how would the build know? (Course model: `masterclassNealFord2026/make-the-grade-pages-28-29/answers.md`, outside this repo; `grade()` has complexity 15, AutoGrading is in the zone of pain with D = 0.857.)

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Task 1: complexity of the agent's function; essential or accidental? | The measurer behind `[TR-Q9]` reproduces the course number: the TypeScript port of `grade()` is 15. The 26 functions at or above 10 are frozen in `complexity-baseline.json`; the largest, `storeMemory` (58) and `parseAdl` (52), are mostly essential (many validation rules, a grammar) but are the first refactor candidates. | `[K2-01]`, `complexity-baseline.json` |
| Task 2: A / I / D per component, which zone? | Computed for the 12 components of `COMPONENT_FILES`. 7 of 12 have D ≥ 0.3, and they are `helpers`, `paths`, `state`, `walk`, `search`, `vectors`, `persistence`: concrete, widely imported, importing little. That is the zone of pain by the formula, and it is exactly what `structure.adl` builds on purpose (enumerated leaves `TR-S1`, one state module `TR-S9`/`TR-S15`). | `[K2-03]`, table below |
| Task 3: is a reported number a fitness function? Write ADL with a stricter agent limit | `[TR-Q9]` already is one for the human limit (10, with a shrinking baseline). The agent limit (5) is added as a ratchet: 71 functions already sit in [5,10), so a flat limit would be red on day one. The count is frozen and may only fall. | `[K2-02]`, `TR-Q9` |
| Task 4: refactor onto the main sequence | Not applicable as in the course. Moving `state`/`paths`/`helpers` toward A ≈ 1 would mean inventing interfaces for a functional TypeScript codebase. The meaningful refactors are the baseline offenders. | disposition below |

## A / I / D on the real tree

| Component | Na | Nc | Ca | Ce | A | I | D |
|---|---|---|---|---|---|---|---|
| helpers | 17 | 42 | 41 | 0 | 0.29 | 0.00 | 0.71 |
| paths | 1 | 18 | 20 | 0 | 0.05 | 0.00 | 0.95 |
| walk | 0 | 7 | 3 | 1 | 0.00 | 0.25 | 0.75 |
| indexcache | 2 | 4 | 1 | 6 | 0.33 | 0.86 | 0.19 |
| state | 0 | 6 | 16 | 1 | 0.00 | 0.06 | 0.94 |
| persistence | 0 | 23 | 19 | 22 | 0.00 | 0.54 | 0.46 |
| search | 0 | 9 | 10 | 2 | 0.00 | 0.17 | 0.83 |
| vectors | 1 | 22 | 12 | 4 | 0.04 | 0.25 | 0.71 |
| registry | 3 | 2 | 8 | 2 | 0.60 | 0.20 | 0.20 |
| tools | 0 | 28 | 7 | 78 | 0.00 | 0.92 | 0.08 |
| server | 2 | 14 | 0 | 19 | 0.13 | 1.00 | 0.13 |
| spec | 8 | 21 | 7 | 9 | 0.28 | 0.56 | 0.16 |

Na = interfaces, type aliases, abstract classes; Nc = exported functions, classes, consts; Ca/Ce = distinct file-to-file import edges across components. These definitions are a choice (TypeScript has no direct equivalent of the Java concrete class), so the numbers are indicative.

## What the sketch adds

- **`[K2-01]`** validates the metric before trusting the gate built on it. `[TR-Q9]` was never checked against an independent answer.
- **`[K2-02]`** gives an agent-code limit that can pass today: a ceiling of 71 on functions in [5,10) outside the baseline. The known-fail adds one function of complexity 6 and the count rises by exactly one. The real fix is a per-function frozen list, like the Q9 baseline; the count ceiling is the sketch.
- **`[K2-03]`** measures A/I/D and records that it is not a usable gate for this repo.

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| measurer vs the course | ported `grade()` = 15; straight-line = 1; +1 per decision | `grade()` breaks both the agent (5) and human (10) limits |
| agent limit ratchet | real tree ≤ 71; a function of complexity 4 adds nothing | one function of complexity 6 is counted, exactly once |
| A/I/D | formulas reproduce the course's five rows; real-tree pain zone = the stable foundation | a concrete component imported by two others → A = 0, I = 0, D = 1 |

9 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `katas/s1-k2-code-quality`, `validate_architecture` on the repo root with `record:false`, `trace` for the three IDs, and the decision stored with `store_memory` (`elements: ["assert:K2-01","assert:K2-02","assert:K2-03"]`).

## Dispositions

| Item | Disposition |
|---|---|
| `[K2-01]` | Promotion candidate at K12 (next free ID `TR-Q12`). |
| `[K2-02]` | Revise at K12: replace the count with a per-function frozen list, or reject. |
| A/I/D as a gate | **Reject** with a reason: the architecture is deliberately a stable concrete foundation plus unstable tools, so D ≥ 0.3 would flag the design itself. Keep it as a measurement only. |
| Agent vs human provenance | Not deterministic: nothing in the tree tells whether a function was agent-written. The agent limit is applied to *new* functions instead. Revisit at K11. |
| `storeMemory` (58), `parseAdl` (52) | Already frozen in the Q9 baseline. No new backlog entry. |
