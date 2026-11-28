# K8 — Stressor × component (course pp. 66–67)

Sketch: [adl/stressors-kata.adl](adl/stressors-kata.adl) · Fitness functions: [k8-stressors.test.ts](../../plugins/total-recall/src/__tests__/katas/k8-stressors.test.ts) · Sketch IDs `[K8-01]`, `[K8-02]` (not `TR-*`; promotion is decided at K12).

**Scenario recap.** List the stressors the architecture must survive, map each to the components it hits, and write each residue as an assertion so the next change (or agent) cannot simplify it away. (Course model: `masterclassNealFord2026/make-the-grade-pages-66-67`, outside this repo; these pages sit in the course's S3 block.)

**This kata is an audit, not a build.** `architecture-style.adl` already has seven stressors `S1..S7`, the incidence matrix and the rule that each names a tagged residue, enforced by `[TR-E1]` (`stressor-residues.test.ts`). The kata asks what that leaves unchecked.

## Questions → answers → evidence

| Course question | Answer for total-recall | Evidence |
|---|---|---|
| Which stressors does the architecture face? | S1 host hook API, S2 missing embedder or native binding, S3 teammate on an older version, S4 vault at tens of thousands, S5 hostile org content, S6 embedding model change, S7 new privacy patterns. | `architecture-style.adl` |
| Does each have a residue assertion? | Yes, machine-checked: every stressor names at least one existing tagged `TR-*`. | `[TR-E1]` |
| Residue for a Claude CLI change (S1)? | S1's residues (`TR-C5`, `TR-C1`) cover the *hook envelope* the host sends. The *nested* `claude -p` the PreCompact hook runs is a different dependency: its flags are sandboxed (`--tools ""`) and tested for that, but no stressor names it. | `[K8-02]` |
| Residue for a sqlite ABI change (S2)? | `TR-R1`, `TR-R3`, plus the native-binding self-heal pinned by `vectorStore` tests. Sufficient. | `TR-R1`, `TR-R3` |
| Residue for 20k scale (S4)? | `TR-P1`, `TR-P2`, plus the weekly full-scale benchmark job. The loadtest targets in `capabilities.adl` are still untagged (the file says so). | `TR-P1`, `TR-P2` |
| Is the matrix itself trustworthy? | Its residue IDs are checked; its file pointers were not. `[K8-01]` checks them, and every one resolves today. | `[K8-01]` |

## What the sketch adds

- **`[K8-01]`** reads the file names in the `S<n> →` incidence lines and requires each to exist under `src`, `hooks`, `scripts` or `architecture`. Runtime artifacts (`index.json`, `invertedIndex.json`, `.index-cache.txt`, `vectors.db`) are not source and are skipped.
- **`[K8-02]`** reads sources of variability from the code and requires a stressor line that names each. Three are found with no stressor:

| Source of variability | Evidence in code | Why it is a stressor |
|---|---|---|
| Node version | `engines.node` is `>=18.0.0`, but the gate runs Node 26 and a native module breaks under another Node (`NODE_MODULE_VERSION`) | the declared range is wider than what is tested |
| Config read once | `src/server.ts`: `specDriven` "is read once here" | a config change is silently ignored until restart |
| Nested `claude -p` | `hooks/scripts/extract-and-store-memories.sh` | a CLI flag change breaks learning extraction; `check-extract-outcomes.sh` only notices after 3 of 5 failures |

## Known-pass / known-fail (plan §3.3)

| Check | Known-pass | Known-fail (synthetic, `os.tmpdir()`) |
|---|---|---|
| `[K8-01]` | all named files exist → `[]`; the real matrix names files and none dangles | a renamed file is named exactly |
| `[K8-02]` | stressors naming all three → `[]`; a source not in the code is not demanded | no stressor → all three named; the real tree → the three above (pinned finding) |

7 tests, all green, so CI is never red on purpose.

## Dogfood log

- `index_architecture` on `plugins/total-recall/architecture/katas/s2-k8-stressors`, `validate_architecture` on the repo root with `record:false`, `trace`, and the decision stored with `store_memory` (`elements: ["assert:K8-01","assert:K8-02"]`).

## Dispositions

| Item | Disposition |
|---|---|
| Three unnamed sources of variability | **Revise ADL** at K12: add `S8` (Node version), `S9` (config read once), `S10` (nested `claude -p`), each with a residue. Candidate residues: the `engines` range aligned with `.nvmrc`; a test that a config change needs a restart (or reload); the `PreCompact` sandbox flags and `TR-P5`. Next free IDs `TR-E2` and up. |
| `[K8-01]` | Promotion candidate at K12 (next free ID `TR-E2`). |
| `[K8-02]` | Promotion at K12 once S8–S10 exist; until then it stays a sketch with its finding pinned. |
| Untagged loadtest targets (S4) | Existing note in `capabilities.adl`; not repeated. |
